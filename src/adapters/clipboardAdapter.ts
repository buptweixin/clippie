import type {
  DocumentAdapter,
  DocumentContext,
  InsertOutcome,
  InsertResult,
} from "./DocumentAdapter";
import { OutcomeObserver } from "../perception/outcomeTracker";

/**
 * L3 clipboard fallback — the level that always works.
 *
 * Saves the user's clipboard, puts the artifact on it, sends a synthetic
 * paste keystroke to the focused window, then restores the original
 * clipboard. Crude, honest, and the guaranteed demo path when neither an
 * app API (L1) nor the accessibility tree (L2) can write to the window.
 *
 * The clipboard/keystroke primitives are injected so this logic is unit
 * testable and so each OS sidecar can supply its own implementation.
 */
export interface ClipboardPrimitives {
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;
  sendPasteKeystroke(): Promise<void>;
  readContextViaOcr(): Promise<DocumentContext>;
  readSelectionViaOcr(): Promise<string>;
}

export class ClipboardAdapter implements DocumentAdapter {
  readonly level = "L3" as const;
  private nextTokenId = 1;
  private insertedByToken = new Map<string, string>();
  private observer: OutcomeObserver;

  constructor(
    private prims: ClipboardPrimitives,
    observer?: OutcomeObserver,
  ) {
    this.observer = observer ?? new OutcomeObserver();
  }

  getContext(): Promise<DocumentContext> {
    return this.prims.readContextViaOcr();
  }

  getSelection(): Promise<string> {
    return this.prims.readSelectionViaOcr();
  }

  async insertAtCursor(text: string): Promise<InsertResult> {
    const saved = await this.prims.readClipboard();
    try {
      await this.prims.writeClipboard(text);
      await this.prims.sendPasteKeystroke();
      const undoToken = `clipboard:${this.nextTokenId++}`;
      this.insertedByToken.set(undoToken, text);
      return {
        ok: true,
        level: "L3",
        degradationNote:
          "Inserted by paste — this window doesn't expose a writable accessibility tree.",
        undoToken,
      };
    } finally {
      // Restore the user's clipboard no matter what happened above.
      await this.prims.writeClipboard(saved);
    }
  }

  async undo(): Promise<boolean> {
    // Paste-level undo is the host app's own undo stack; we surface that
    // honestly instead of pretending to track the document ourselves.
    return false;
  }

  observeOutcome(undoToken: string, cb: (o: InsertOutcome) => void): void {
    const inserted = this.insertedByToken.get(undoToken);
    if (!inserted) return;
    this.insertedByToken.delete(undoToken);
    this.observer.watch(
      inserted,
      async () => {
        const ctx = await this.prims.readContextViaOcr();
        return `${ctx.textBeforeCursor}${ctx.textAfterCursor}`;
      },
      cb,
    );
  }
}
