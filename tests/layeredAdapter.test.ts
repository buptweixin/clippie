import { describe, expect, it } from "vitest";
import type { DocumentAdapter, InsertOutcome } from "../src/adapters/DocumentAdapter";
import { LayeredDocumentAdapter } from "../src/adapters/LayeredDocumentAdapter";
import { MockDocumentAdapter } from "../src/adapters/MockDocumentAdapter";
import { runAdapterConformanceSuite } from "./adapterConformance";

function createFailingAdapter(level: "L1" | "L2"): DocumentAdapter {
  return {
    level,
    async getContext() {
      throw new Error(`${level} unavailable`);
    },
    async getSelection() {
      throw new Error(`${level} unavailable`);
    },
    async insertAtCursor() {
      return { ok: false, level };
    },
    async undo() {
      return false;
    },
    observeOutcome() {},
  };
}

runAdapterConformanceSuite("LayeredDocumentAdapter (L1 -> L2 fallback)", {
  supportsUndo: true,
  createAdapter: ({ text, cursor, selectionEnd, referenceText }) =>
    new LayeredDocumentAdapter([
      createFailingAdapter("L1"),
      new MockDocumentAdapter({
        level: "L2",
        appName: "Word",
        initialText: text,
        selectionStart: cursor,
        selectionEnd,
        visibleReferenceText: referenceText,
      }),
    ]),
});

describe("LayeredDocumentAdapter degradation & routing", () => {
  it("falls back L1 -> L2 -> L3, attaches honest degradationNote, and routes outcome", async () => {
    const l3 = new MockDocumentAdapter({
      level: "L3",
      appName: "AdminWindow",
      initialText: "Draft: ",
      selectionStart: 7,
    });
    const layered = new LayeredDocumentAdapter([
      createFailingAdapter("L1"),
      createFailingAdapter("L2"),
      l3,
    ]);

    expect(layered.level).toBe("L1");
    const res = await layered.insertAtCursor("pasted bridge");
    expect(res.ok).toBe(true);
    expect(res.level).toBe("L3");
    expect(res.degradationNote).toContain("Inserted by paste");
    expect(l3.getText()).toBe("Draft: pasted bridge");

    const observed: InsertOutcome[] = [];
    layered.observeOutcome(res.undoToken!, (o) => observed.push(o));
    l3.emitOutcome(res.undoToken!, "kept");
    expect(observed).toEqual(["kept"]);
  });
});
