import type {
  AdapterLevel,
  DocumentAdapter,
  DocumentContext,
  InsertOutcome,
  InsertResult,
} from "./DocumentAdapter";

const DEFAULT_L3_NOTE =
  "Inserted by paste — this window doesn't expose a writable accessibility tree.";

/**
 * LayeredDocumentAdapter — orchestrates L1 → L2 → L3 execution with honest
 * graceful degradation (see README.md and docs/architecture.md).
 *
 * - Reads context/selection from the highest-priority adapter that succeeds.
 * - Inserts via the highest-priority adapter that succeeds; if execution falls
 *   back to a lower layer (e.g. L1 → L2 or L2 → L3), preserves or attaches an
 *   honest `degradationNote`.
 * - Routes `undo(undoToken)` and `observeOutcome(undoToken, cb)` to whichever
 *   adapter actually performed that insertion.
 */
export class LayeredDocumentAdapter implements DocumentAdapter {
  private readonly adapters: DocumentAdapter[];
  private readonly tokenOwners = new Map<string, DocumentAdapter>();

  constructor(adapters: DocumentAdapter[]) {
    if (adapters.length === 0) {
      throw new Error("LayeredDocumentAdapter requires at least one adapter");
    }
    this.adapters = [...adapters];
  }

  get level(): AdapterLevel {
    return this.adapters[0].level;
  }

  async getContext(): Promise<DocumentContext> {
    let lastError: unknown;
    for (const adapter of this.adapters) {
      try {
        return await adapter.getContext();
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("All DocumentAdapters failed in getContext()");
  }

  async getSelection(): Promise<string> {
    let lastError: unknown;
    for (const adapter of this.adapters) {
      try {
        return await adapter.getSelection();
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("All DocumentAdapters failed in getSelection()");
  }

  async insertAtCursor(text: string): Promise<InsertResult> {
    const preferredLevel = this.adapters[0].level;
    let degradedFromHigherLayer = false;

    for (const adapter of this.adapters) {
      try {
        const res = await adapter.insertAtCursor(text);
        if (!res.ok) {
          degradedFromHigherLayer = true;
          continue;
        }

        if (res.undoToken) {
          this.tokenOwners.set(res.undoToken, adapter);
        }

        const degraded = degradedFromHigherLayer || res.level !== preferredLevel;
        const degradationNote =
          res.degradationNote ??
          (degraded && res.level === "L3" ? DEFAULT_L3_NOTE : undefined);

        return {
          ...res,
          degradationNote,
        };
      } catch {
        degradedFromHigherLayer = true;
      }
    }

    return {
      ok: false,
      level: this.adapters[this.adapters.length - 1].level,
      degradationNote: "All execution layers failed to insert at cursor.",
    };
  }

  async undo(undoToken: string): Promise<boolean> {
    const owner = this.tokenOwners.get(undoToken);
    if (!owner) return false;
    const undone = await owner.undo(undoToken);
    if (undone) {
      this.tokenOwners.delete(undoToken);
    }
    return undone;
  }

  observeOutcome(undoToken: string, cb: (o: InsertOutcome) => void): void {
    const owner = this.tokenOwners.get(undoToken);
    owner?.observeOutcome(undoToken, cb);
  }
}
