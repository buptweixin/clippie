import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as readline from "node:readline";
import type {
  AdapterLevel,
  DocumentAdapter,
  DocumentContext,
  InsertOutcome,
  InsertResult,
} from "./DocumentAdapter";

export interface SidecarPermissionStatus {
  accessibility: boolean;
  screenRecording: boolean;
}

export interface SidecarRequest {
  id: number;
  method:
    | "ping"
    | "check_permissions"
    | "get_context"
    | "get_selection"
    | "insert_at_cursor"
    | "undo";
  params?: Record<string, unknown>;
}

export interface SidecarResponse {
  id: number;
  ok: boolean;
  result?: Record<string, unknown>;
  error?: string;
}

export interface SidecarTransport {
  request(
    method: SidecarRequest["method"],
    params?: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  close?(): Promise<void>;
}

/**
 * NDJSON stdio transport spawning a native sidecar binary (e.g. macOS Swift
 * sidecar built from native/macos/Sidecar.swift with `--stdio`).
 */
export class StdioSidecarTransport implements SidecarTransport {
  private proc: ChildProcessWithoutNullStreams;
  private rl: readline.Interface;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }
  >();

  constructor(
    binaryPath: string,
    args: string[] = ["--stdio"],
    private timeoutMs: number = 5000,
  ) {
    this.proc = spawn(binaryPath, args, { stdio: ["pipe", "pipe", "pipe"] });
    this.rl = readline.createInterface({ input: this.proc.stdout });

    this.rl.on("line", (line) => {
      if (!line.trim()) return;
      let msg: SidecarResponse;
      try {
        msg = JSON.parse(line) as SidecarResponse;
      } catch {
        return;
      }
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      if (msg.ok) {
        entry.resolve(msg.result ?? {});
      } else {
        entry.reject(new Error(msg.error ?? "Sidecar request failed"));
      }
    });

    this.proc.on("exit", (code) => {
      const err = new Error(`Sidecar exited with code ${code ?? "null"}`);
      for (const [, p] of this.pending) {
        p.reject(err);
      }
      this.pending.clear();
    });
  }

  request(
    method: SidecarRequest["method"],
    params?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    const payload: SidecarRequest = { id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error(`Sidecar request "${method}" timed out`));
        }
      }, this.timeoutMs);

      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });

      this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
    });
  }

  async close(): Promise<void> {
    this.rl.close();
    this.proc.kill();
  }
}

/**
 * DocumentAdapter backed by an OS native sidecar (macOS AX / Windows UIA).
 * Surfaces honest L2→L3 degradation reported by the sidecar.
 */
export class SidecarDocumentAdapter implements DocumentAdapter {
  readonly level: AdapterLevel = "L2";
  private outcomeListeners = new Map<string, (o: InsertOutcome) => void>();

  constructor(private transport: SidecarTransport) {}

  async checkPermissions(): Promise<SidecarPermissionStatus> {
    const res = await this.transport.request("check_permissions");
    return {
      accessibility: Boolean(res.accessibility),
      screenRecording: Boolean(res.screenRecording),
    };
  }

  async getContext(): Promise<DocumentContext> {
    const res = await this.transport.request("get_context");
    return {
      appName: String(res.appName ?? "Unknown"),
      textBeforeCursor: String(res.before ?? ""),
      textAfterCursor: String(res.after ?? ""),
      visibleReferenceText:
        typeof res.visibleReferenceText === "string"
          ? res.visibleReferenceText
          : undefined,
    };
  }

  async getSelection(): Promise<string> {
    const res = await this.transport.request("get_selection");
    return String(res.selected ?? "");
  }

  async insertAtCursor(text: string): Promise<InsertResult> {
    const res = await this.transport.request("insert_at_cursor", { text });
    const level: AdapterLevel =
      res.level === "L1" || res.level === "L2" || res.level === "L3"
        ? res.level
        : "L2";
    return {
      ok: res.ok !== false,
      level,
      degradationNote:
        typeof res.degradationNote === "string" ? res.degradationNote : undefined,
      undoToken: typeof res.undoToken === "string" ? res.undoToken : undefined,
    };
  }

  async undo(undoToken: string): Promise<boolean> {
    const res = await this.transport.request("undo", { undoToken });
    return Boolean(res.ok);
  }

  observeOutcome(undoToken: string, cb: (o: InsertOutcome) => void): void {
    this.outcomeListeners.set(undoToken, cb);
  }

  /** Called by the perception daemon when an outcome window finishes. */
  notifyOutcome(undoToken: string, outcome: InsertOutcome): void {
    const cb = this.outcomeListeners.get(undoToken);
    if (!cb) return;
    this.outcomeListeners.delete(undoToken);
    cb(outcome);
  }
}
