/**
 * DocumentAdapter — the unified execution interface.
 *
 * Every platform/app integration implements these four methods, at one of
 * three levels, and the agent loop does not care which level served it:
 *   L1  app-specific APIs (Office JS, Docs extension, VS Code API)
 *   L2  OS accessibility APIs (macOS AXUIElement, Windows UI Automation)
 *   L3  clipboard fallback (always available, honest about its limits)
 */
export interface DocumentContext {
  appName: string;
  /** Text around the cursor: up to ~2k chars before, ~500 after. */
  textBeforeCursor: string;
  textAfterCursor: string;
  /** OCR text of other visible material (e.g. a reference PDF), if any. */
  visibleReferenceText?: string;
}

export type AdapterLevel = "L1" | "L2" | "L3";

export interface InsertResult {
  ok: boolean;
  level: AdapterLevel;
  /** Set when the level degraded and the UI must say so honestly. */
  degradationNote?: string;
  /** Opaque token that restores the pre-insert snapshot. */
  undoToken?: string;
}

export interface DocumentAdapter {
  readonly level: AdapterLevel;
  getContext(): Promise<DocumentContext>;
  getSelection(): Promise<string>;
  insertAtCursor(text: string): Promise<InsertResult>;
  undo(undoToken: string): Promise<boolean>;
  /** Subscribe to edit outcomes after an insert (kept / edited / deleted). */
  observeOutcome(undoToken: string, cb: (o: InsertOutcome) => void): void;
}

export type InsertOutcome = "kept" | "edited" | "deleted";
