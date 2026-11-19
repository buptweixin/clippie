import type {
  DocumentAdapter,
  DocumentContext,
  InsertResult,
} from "./DocumentAdapter";

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
  constructor(private prims: ClipboardPrimitives) {}

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
      return {
        ok: true,
        level: "L3",
        degradationNote:
          "Inserted by paste — this window doesn't expose a writable accessibility tree.",
        undoToken: `clipboard:${Date.now()}`,
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

  observeOutcome(): void {
    // Outcome observation at L3 relies on the perception daemon's edit
    // events rather than document APIs; wired up in the agent loop.
  }
}
