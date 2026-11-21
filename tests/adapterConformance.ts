import { describe, expect, it } from "vitest";
import type { DocumentAdapter } from "../src/adapters/DocumentAdapter";

export interface ConformanceFixture {
  createAdapter(initial: {
    text: string;
    cursor: number;
    selectionEnd?: number;
    referenceText?: string;
  }): Promise<DocumentAdapter> | DocumentAdapter;
  supportsUndo: boolean;
}

/**
 * Shared DocumentAdapter conformance suite (see .kiro/steering/tech.md and
 * docs/devin-plan.md). Every platform adapter (Mock, macOS AX, Windows UIA)
 * must pass this contract.
 */
export function runAdapterConformanceSuite(
  name: string,
  fixture: ConformanceFixture,
): void {
  describe(`DocumentAdapter conformance: ${name}`, () => {
    it("reads context around the cursor", async () => {
      const adapter = await fixture.createAdapter({
        text: "Hello world!",
        cursor: 6,
        referenceText: "Reference paragraph.",
      });

      const ctx = await adapter.getContext();
      expect(ctx.appName.length).toBeGreaterThan(0);
      expect(ctx.textBeforeCursor).toBe("Hello ");
      expect(ctx.textAfterCursor).toBe("world!");
      expect(ctx.visibleReferenceText).toBe("Reference paragraph.");
    });

    it("reads the current selection", async () => {
      const adapter = await fixture.createAdapter({
        text: "Alpha Beta Gamma",
        cursor: 6,
        selectionEnd: 10,
      });

      expect(await adapter.getSelection()).toBe("Beta");
    });

    it("inserts at cursor and advances cursor past the inserted text", async () => {
      const adapter = await fixture.createAdapter({
        text: "Start end.",
        cursor: 6,
      });

      const res = await adapter.insertAtCursor("middle ");
      expect(res.ok).toBe(true);
      expect(["L1", "L2", "L3"]).toContain(res.level);

      const after = await adapter.getContext();
      expect(after.textBeforeCursor).toBe("Start middle ");
      expect(after.textAfterCursor).toBe("end.");
    });

    it("replaces non-empty selection on insert", async () => {
      const adapter = await fixture.createAdapter({
        text: "One [TODO] three",
        cursor: 4,
        selectionEnd: 10,
      });

      const res = await adapter.insertAtCursor("two");
      expect(res.ok).toBe(true);

      const ctx = await adapter.getContext();
      expect(ctx.textBeforeCursor).toBe("One two");
      expect(ctx.textAfterCursor).toBe(" three");
      expect(await adapter.getSelection()).toBe("");
    });

    it("handles snapshot-backed undo consistently", async () => {
      const adapter = await fixture.createAdapter({
        text: "Before after",
        cursor: 7,
      });

      const res = await adapter.insertAtCursor("inserted ");
      expect(res.ok).toBe(true);

      if (fixture.supportsUndo) {
        expect(res.undoToken).toBeTruthy();
        const undone = await adapter.undo(res.undoToken!);
        expect(undone).toBe(true);

        const restored = await adapter.getContext();
        expect(restored.textBeforeCursor).toBe("Before ");
        expect(restored.textAfterCursor).toBe("after");

        // Second undo with the same consumed token returns false.
        expect(await adapter.undo(res.undoToken!)).toBe(false);
      } else {
        expect(await adapter.undo("nonexistent")).toBe(false);
      }
    });
  });
}
