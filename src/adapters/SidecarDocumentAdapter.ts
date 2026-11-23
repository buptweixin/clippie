import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as readline from "node:readline";
import type {
  AdapterLevel,
  DocumentAdapter,
  DocumentContext,
  InsertOutcome,
  InsertResult,
} from "./DocumentAdapter";
import type { SnapshotProvider, TriggerSnapshot } from "../agent/loop";
import { OutcomeObserver } from "../perception/outcomeTracker";

export interface SidecarPermissionStatus {
  accessibility: boolean;
  screenRecording: boolean;
  targetIsElevated?: boolean;
}

export interface SidecarRequest {
  id: number;
  method:
    | "ping"
    | "check_permissions"
    | "get_context"
    | "get_selection"
    | "insert_at_cursor"
    | "undo"
    | "capture_snapshot";
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
 * DocumentAdapter + SnapshotProvider backed by an OS native sidecar
 * (macOS AX+Vision / Windows UIA). Surfaces honest L2→L3 degradation.
 */
export class SidecarDocumentAdapter implements DocumentAdapter, SnapshotProvider {
  readonly level: AdapterLevel = "L2";
  private outcomeListeners = new Map<string, (o: InsertOutcome) => void>();
  private insertedByToken = new Map<string, string>();
  private observer: OutcomeObserver;

  constructor(
    private transport: SidecarTransport,
    observer?: OutcomeObserver,
  ) {
    this.observer = observer ?? new OutcomeObserver();
  }

  async checkPermissions(): Promise<SidecarPermissionStatus> {
    const res = await this.transport.request("check_permissions");
    return {
      accessibility: Boolean(res.accessibility),
      screenRecording: Boolean(res.screenRecording),
      targetIsElevated:
        typeof res.targetIsElevated === "boolean"
          ? res.targetIsElevated
          : undefined,
    };
  }

  async captureSnapshot(): Promise<TriggerSnapshot | null> {
    try {
      const res = await this.transport.request("capture_snapshot");
      return {
        ocrText: typeof res.ocrText === "string" ? res.ocrText : undefined,
        imageCropBase64:
          typeof res.imageCropBase64 === "string"
            ? res.imageCropBase64
            : undefined,
        dHashHex: typeof res.dHashHex === "string" ? res.dHashHex : undefined,
      };
    } catch {
      return null;
    }
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
    const ok = res.ok !== false;
    const undoToken =
      typeof res.undoToken === "string"
        ? res.undoToken
        : ok && level === "L3"
          ? `sidecar-paste:${Date.now()}`
          : undefined;
    if (ok && undoToken) {
      this.insertedByToken.set(undoToken, text);
    }
    return {
      ok,
      level,
      degradationNote:
        typeof res.degradationNote === "string" ? res.degradationNote : undefined,
      undoToken,
    };
  }

  async undo(undoToken: string): Promise<boolean> {
    if (undoToken.startsWith("sidecar-paste:")) return false;
    const res = await this.transport.request("undo", { undoToken });
    return Boolean(res.ok);
  }

  observeOutcome(undoToken: string, cb: (o: InsertOutcome) => void): void {
    this.outcomeListeners.set(undoToken, cb);
    const inserted = this.insertedByToken.get(undoToken);
    if (!inserted) return;
    this.insertedByToken.delete(undoToken);
    this.observer.watch(
      inserted,
      async () => {
        const ctx = await this.getContext();
        return `${ctx.textBeforeCursor}${ctx.textAfterCursor}`;
      },
      (outcome) => {
        this.notifyOutcome(undoToken, outcome);
      },
    );
  }

  /** Called by the perception daemon or OutcomeObserver when an outcome window finishes. */
  notifyOutcome(undoToken: string, outcome: InsertOutcome): void {
    const cb = this.outcomeListeners.get(undoToken);
    if (!cb) return;
    this.outcomeListeners.delete(undoToken);
    cb(outcome);
  }
}
