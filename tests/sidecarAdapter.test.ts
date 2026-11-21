import { describe, expect, it } from "vitest";
import {
  SidecarDocumentAdapter,
  StdioSidecarTransport,
  type SidecarRequest,
  type SidecarTransport,
} from "../src/adapters/SidecarDocumentAdapter";
import { runAdapterConformanceSuite } from "./adapterConformance";

function createInMemorySidecarTransport(initial: {
  text: string;
  cursor: number;
  selectionEnd?: number;
  referenceText?: string;
}): SidecarTransport {
  let text = initial.text;
  let start = initial.cursor;
  let end = initial.selectionEnd ?? initial.cursor;
  let nextUndo = 1;
  const snapshots = new Map<string, { text: string; start: number; end: number }>();

  return {
    async request(method: SidecarRequest["method"], params = {}) {
      switch (method) {
        case "check_permissions":
          return { accessibility: true, screenRecording: true };
        case "get_context": {
          const beforeStart = Math.max(0, start - 2000);
          const afterEnd = Math.min(text.length, end + 500);
          return {
            appName: "TextEdit",
            before: text.slice(beforeStart, start),
            after: text.slice(end, afterEnd),
            visibleReferenceText: initial.referenceText,
          };
        }
        case "get_selection":
          return { selected: text.slice(start, end) };
        case "insert_at_cursor": {
          const insertText = String(params.text ?? "");
          const token = `ax:${nextUndo++}`;
          snapshots.set(token, { text, start, end });
          text = text.slice(0, start) + insertText + text.slice(end);
          start = start + insertText.length;
          end = start;
          return { ok: true, level: "L2", undoToken: token };
        }
        case "undo": {
          const token = String(params.undoToken ?? "");
          const snap = snapshots.get(token);
          if (!snap) return { ok: false };
          snapshots.delete(token);
          text = snap.text;
          start = snap.start;
          end = snap.end;
          return { ok: true };
        }
        case "ping":
          return { pong: true };
      }
    },
  };
}

runAdapterConformanceSuite("SidecarDocumentAdapter (L2 mock transport)", {
  supportsUndo: true,
  createAdapter: (initial) =>
    new SidecarDocumentAdapter(createInMemorySidecarTransport(initial)),
});

describe("SidecarDocumentAdapter & StdioSidecarTransport", () => {
  it("communicates over NDJSON stdio with a child process", async () => {
    const stubScript = [
      'const rl = require("readline").createInterface({ input: process.stdin });',
      'rl.on("line", (line) => {',
      "  const req = JSON.parse(line);",
      '  if (req.method === "check_permissions") {',
      '    process.stdout.write(JSON.stringify({ id: req.id, ok: true, result: { accessibility: true, screenRecording: false } }) + "\\n");',
      '  } else if (req.method === "insert_at_cursor") {',
      '    process.stdout.write(JSON.stringify({ id: req.id, ok: true, result: { ok: true, level: "L3", degradationNote: "Inserted by paste" } }) + "\\n");',
      "  } else {",
      '    process.stdout.write(JSON.stringify({ id: req.id, ok: true, result: {} }) + "\\n");',
      "  }",
      "});",
    ].join("\n");

    const transport = new StdioSidecarTransport(process.execPath, ["-e", stubScript]);
    const adapter = new SidecarDocumentAdapter(transport);
    try {
      const perms = await adapter.checkPermissions();
      expect(perms).toEqual({ accessibility: true, screenRecording: false });

      const res = await adapter.insertAtCursor("hello");
      expect(res.ok).toBe(true);
      expect(res.level).toBe("L3");
      expect(res.degradationNote).toBe("Inserted by paste");
    } finally {
      await transport.close();
    }
  });
});
