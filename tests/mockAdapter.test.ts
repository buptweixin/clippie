import { describe, expect, it } from "vitest";
import { MockDocumentAdapter } from "../src/adapters/MockDocumentAdapter";
import { runAdapterConformanceSuite } from "./adapterConformance";

runAdapterConformanceSuite("MockDocumentAdapter (L1)", {
  supportsUndo: true,
  createAdapter: ({ text, cursor, selectionEnd, referenceText }) =>
    new MockDocumentAdapter({
      level: "L1",
      appName: "Word",
      initialText: text,
      selectionStart: cursor,
      selectionEnd,
      visibleReferenceText: referenceText,
    }),
});

runAdapterConformanceSuite("MockDocumentAdapter (L3 degraded)", {
  supportsUndo: false,
  createAdapter: ({ text, cursor, selectionEnd, referenceText }) =>
    new MockDocumentAdapter({
      level: "L3",
      appName: "AdminNotepad",
      initialText: text,
      selectionStart: cursor,
      selectionEnd,
      visibleReferenceText: referenceText,
    }),
});

describe("MockDocumentAdapter specifics", () => {
  it("reports honest degradationNote at L3 and truncates long context windows", async () => {
    const longBefore = "a".repeat(2500);
    const longAfter = "b".repeat(700);
    const adapter = new MockDocumentAdapter({
      level: "L3",
      initialText: longBefore + longAfter,
      selectionStart: 2500,
    });

    const ctx = await adapter.getContext();
    expect(ctx.textBeforeCursor.length).toBe(2000);
    expect(ctx.textAfterCursor.length).toBe(500);

    const res = await adapter.insertAtCursor("X");
    expect(res.level).toBe("L3");
    expect(res.degradationNote).toContain("Inserted by paste");
  });
});
