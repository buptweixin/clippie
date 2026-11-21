import type {
  AdapterLevel,
  DocumentAdapter,
  DocumentContext,
  InsertOutcome,
  InsertResult,
} from "./DocumentAdapter";

export interface MockDocumentOptions {
  appName?: string;
  initialText?: string;
  selectionStart?: number;
  selectionEnd?: number;
  visibleReferenceText?: string;
  level?: AdapterLevel;
  supportsUndo?: boolean;
}

interface Snapshot {
  text: string;
  selectionStart: number;
  selectionEnd: number;
  insertedStart: number;
  insertedEnd: number;
}

const CONTEXT_BEFORE_LIMIT = 2000;
const CONTEXT_AFTER_LIMIT = 500;

/**
 * In-memory DocumentAdapter for Milestone 1 E2E loop tests and the
 * shared adapter conformance suite.
 */
export class MockDocumentAdapter implements DocumentAdapter {
  readonly level: AdapterLevel;
  private appName: string;
  private text: string;
  private selectionStart: number;
  private selectionEnd: number;
  private visibleReferenceText?: string;
  private supportsUndo: boolean;
  private nextTokenId = 1;
  private snapshots = new Map<string, Snapshot>();
  private outcomeListeners = new Map<string, (o: InsertOutcome) => void>();

  constructor(options: MockDocumentOptions = {}) {
    this.level = options.level ?? "L1";
    this.appName = options.appName ?? "MockWord";
    this.text = options.initialText ?? "";
    const len = this.text.length;
    this.selectionStart = clamp(options.selectionStart ?? len, 0, len);
    this.selectionEnd = clamp(options.selectionEnd ?? this.selectionStart, this.selectionStart, len);
    this.visibleReferenceText = options.visibleReferenceText;
    this.supportsUndo = options.supportsUndo ?? this.level !== "L3";
  }

  getText(): string {
    return this.text;
  }

  getCursor(): { start: number; end: number } {
    return { start: this.selectionStart, end: this.selectionEnd };
  }

  setSelection(start: number, end: number = start): void {
    const s = clamp(start, 0, this.text.length);
    const e = clamp(end, s, this.text.length);
    this.selectionStart = s;
    this.selectionEnd = e;
  }

  setReferenceText(ref?: string): void {
    this.visibleReferenceText = ref;
  }

  async getContext(): Promise<DocumentContext> {
    const beforeStart = Math.max(0, this.selectionStart - CONTEXT_BEFORE_LIMIT);
    const afterEnd = Math.min(this.text.length, this.selectionEnd + CONTEXT_AFTER_LIMIT);
    return {
      appName: this.appName,
      textBeforeCursor: this.text.slice(beforeStart, this.selectionStart),
      textAfterCursor: this.text.slice(this.selectionEnd, afterEnd),
      visibleReferenceText: this.visibleReferenceText,
    };
  }

  async getSelection(): Promise<string> {
    return this.text.slice(this.selectionStart, this.selectionEnd);
  }

  async insertAtCursor(insertText: string): Promise<InsertResult> {
    const prevText = this.text;
    const prevStart = this.selectionStart;
    const prevEnd = this.selectionEnd;

    this.text =
      prevText.slice(0, prevStart) + insertText + prevText.slice(prevEnd);
    const afterCursor = prevStart + insertText.length;
    this.selectionStart = afterCursor;
    this.selectionEnd = afterCursor;

    const undoToken = `mock:${this.nextTokenId++}`;
    this.snapshots.set(undoToken, {
      text: prevText,
      selectionStart: prevStart,
      selectionEnd: prevEnd,
      insertedStart: prevStart,
      insertedEnd: afterCursor,
    });

    return {
      ok: true,
      level: this.level,
      degradationNote:
        this.level === "L3"
          ? "Inserted by paste — this window doesn't expose a writable accessibility tree."
          : undefined,
      undoToken,
    };
  }

  async undo(undoToken: string): Promise<boolean> {
    if (!this.supportsUndo) return false;
    const snap = this.snapshots.get(undoToken);
    if (!snap) return false;

    this.text = snap.text;
    this.selectionStart = snap.selectionStart;
    this.selectionEnd = snap.selectionEnd;
    this.snapshots.delete(undoToken);
    return true;
  }

  observeOutcome(undoToken: string, cb: (o: InsertOutcome) => void): void {
    if (!this.snapshots.has(undoToken)) return;
    this.outcomeListeners.set(undoToken, cb);
  }

  /** Simulate user behavior after an insertion to drive the feedback loop. */
  emitOutcome(undoToken: string, outcome: InsertOutcome): void {
    const cb = this.outcomeListeners.get(undoToken);
    if (!cb) return;
    this.outcomeListeners.delete(undoToken);
    if (outcome === "deleted") {
      const snap = this.snapshots.get(undoToken);
      if (snap) {
        this.text = snap.text;
        this.selectionStart = snap.selectionStart;
        this.selectionEnd = snap.selectionEnd;
      }
    }
    cb(outcome);
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
