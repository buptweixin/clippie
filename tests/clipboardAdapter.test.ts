import { describe, expect, it, vi } from "vitest";
import {
  ClipboardAdapter,
  type ClipboardPrimitives,
} from "../src/adapters/clipboardAdapter";

function makePrims(initialClipboard = "user-copied-link"): {
  prims: ClipboardPrimitives;
  getClipboard: () => string;
  writes: string[];
} {
  let clipboard = initialClipboard;
  const writes: string[] = [];
  const prims: ClipboardPrimitives = {
    readClipboard: async () => clipboard,
    writeClipboard: async (text) => {
      clipboard = text;
      writes.push(text);
    },
    sendPasteKeystroke: async () => {},
    readContextViaOcr: async () => ({
      appName: "GoogleDocs",
      textBeforeCursor: "Draft paragraph.",
      textAfterCursor: "",
    }),
    readSelectionViaOcr: async () => "selected",
  };
  return { prims, getClipboard: () => clipboard, writes };
}

describe("ClipboardAdapter (L3)", () => {
  it("saves and restores the user clipboard around synthetic paste", async () => {
    const { prims, getClipboard, writes } = makePrims("important-url");
    const adapter = new ClipboardAdapter(prims);

    const res = await adapter.insertAtCursor("Transition sentence.");
    expect(res.ok).toBe(true);
    expect(res.level).toBe("L3");
    expect(res.degradationNote).toContain("Inserted by paste");
    expect(writes).toEqual(["Transition sentence.", "important-url"]);
    expect(getClipboard()).toBe("important-url");
  });

  it("still restores the user clipboard even if synthetic paste throws", async () => {
    const { prims, getClipboard } = makePrims("keep-me");
    prims.sendPasteKeystroke = vi.fn(async () => {
      throw new Error("CGEvent post failed");
    });
    const adapter = new ClipboardAdapter(prims);

    await expect(adapter.insertAtCursor("artifact")).rejects.toThrow(
      "CGEvent post failed",
    );
    expect(getClipboard()).toBe("keep-me");
  });

  it("honestly returns false for undo and delegates OCR reads", async () => {
    const { prims } = makePrims();
    const adapter = new ClipboardAdapter(prims);

    expect(await adapter.undo()).toBe(false);
    expect((await adapter.getContext()).appName).toBe("GoogleDocs");
    expect(await adapter.getSelection()).toBe("selected");
  });
});
