import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import { LayeredDocumentAdapter } from "../adapters/LayeredDocumentAdapter";
import { MockDocumentAdapter } from "../adapters/MockDocumentAdapter";
import { AgentLoop, type Artifact, type BubbleNotice } from "../agent/loop";
import { LocalFallbackModelClient } from "../agent/modelClient";
import type { PerceptionEvent, StuckType } from "../perception/stuckDetector";

type Choice = "insert" | "another" | "dismiss";

interface ActiveOffer {
  artifact: Artifact;
  stuckType: StuckType;
  resolve: (choice: Choice) => void;
}

const PORT = Number(process.env.CLIPPIE_DEMO_PORT ?? 4173);
const ROOT = path.resolve(__dirname, "../..");

let docAdapter = new MockDocumentAdapter({
  level: "L2",
  appName: "Word",
  initialText:
    "2. Related Work\nRecent sparse and IO-aware attention kernels substantially reduce quadratic memory overhead on long sequences.\n\n3. Method\n",
  selectionStart: 138,
  visibleReferenceText:
    "Dao et al. (2024) — FlashAttention-2 achieves 2x-3x speedup via warp-level tiling.",
});

let activeOffer: ActiveOffer | null = null;
let latestNotice: BubbleNotice | null = null;
let modelCallCount = 0;

function createSession(): AgentLoop {
  const baseModel = new LocalFallbackModelClient();
  return new AgentLoop(
    docAdapter,
    {
      async proposeArtifact(input) {
        modelCallCount += 1;
        return baseModel.proposeArtifact(input);
      },
    },
    {
      offer(artifact, stuckType) {
        return new Promise<Choice>((resolve) => {
          activeOffer = { artifact, stuckType, resolve };
        });
      },
      notify(notice) {
        latestNotice = notice;
      },
    },
  );
}

let loop = createSession();

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
      } catch {
        resolve({});
      }
    });
  });
}

function sendJson(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

function currentState() {
  return {
    docText: docAdapter.getText(),
    cursor: docAdapter.getCursor(),
    modelCallCount,
    classicMode: loop.isClassicMode(),
    offer: activeOffer
      ? {
          artifact: activeOffer.artifact,
          stuckType: activeOffer.stuckType,
        }
      : null,
    notice: latestNotice,
    stats: {
      missingTransition: loop.getStats("missing-transition", "Word"),
      blankPage: loop.getStats("blank-page", "Word"),
      blankPageSilenced: loop.isSilenced("blank-page", "Word"),
    },
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);

  if (req.method === "GET" && url.pathname === "/") {
    const htmlPath = path.join(ROOT, "src/demo/stage.html");
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(fs.readFileSync(htmlPath, "utf8"));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/timings") {
    const timingsPath = path.join(ROOT, "out/audio/timings.json");
    if (fs.existsSync(timingsPath)) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(fs.readFileSync(timingsPath, "utf8"));
      return;
    }
    sendJson(res, { scenes: [] });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    sendJson(res, currentState());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/reset") {
    docAdapter = new MockDocumentAdapter({
      level: "L2",
      appName: "Word",
      initialText:
        "2. Related Work\nRecent sparse and IO-aware attention kernels substantially reduce quadratic memory overhead on long sequences.\n\n3. Method\n",
      selectionStart: 138,
      visibleReferenceText:
        "Dao et al. (2024) — FlashAttention-2 achieves 2x-3x speedup via warp-level tiling.",
    });
    activeOffer = null;
    latestNotice = null;
    modelCallCount = 0;
    loop = createSession();
    sendJson(res, currentState());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/set-doc") {
    const body = await readBody(req);
    const text = String(body.text ?? "");
    docAdapter = new MockDocumentAdapter({
      level: "L2",
      appName: "Word",
      initialText: text,
      selectionStart: text.length,
      visibleReferenceText:
        "Dao et al. (2024) — FlashAttention-2 achieves 2x-3x speedup via warp-level tiling.",
    });
    loop = createSession();
    sendJson(res, currentState());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/events") {
    const body = await readBody(req);
    const events = (body.events as PerceptionEvent[]) ?? [];
    const appName = String(body.appName ?? "Word");
    latestNotice = null;
    void loop.onEvents(events, appName);
    await new Promise((r) => setTimeout(r, 40));
    sendJson(res, currentState());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/respond") {
    const body = await readBody(req);
    const choice = (body.choice as Choice) ?? "dismiss";
    if (activeOffer) {
      const pending = activeOffer;
      activeOffer = null;
      pending.resolve(choice);
      await new Promise((r) => setTimeout(r, 50));
    }
    sendJson(res, currentState());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/outcome") {
    const body = await readBody(req);
    const token = String(body.undoToken ?? "mock:1");
    const outcome = (body.outcome as "kept" | "edited" | "deleted") ?? "kept";
    docAdapter.emitOutcome(token, outcome);
    sendJson(res, currentState());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/degraded-insert") {
    const body = await readBody(req);
    const initial = String(body.initialText ?? "Admin Deployment Notes:\n");
    const insert = String(
      body.insertText ??
        "In summary, the referenced passage highlights Dao et al. (2024) — FlashAttention-2 achieves 2x-3x speedup, directly informing our kernel configuration.",
    );
    const blockedL2 = {
      level: "L2" as const,
      getContext: () => docAdapter.getContext(),
      getSelection: () => docAdapter.getSelection(),
      insertAtCursor: async () => ({ ok: false, level: "L2" as const }),
      undo: async () => false,
      observeOutcome: () => {},
    };
    const pasteL3 = new MockDocumentAdapter({
      level: "L3",
      appName: "AdminConsole",
      initialText: initial,
      selectionStart: initial.length,
    });
    const layered = new LayeredDocumentAdapter([blockedL2, pasteL3]);
    const result = await layered.insertAtCursor(insert);
    sendJson(res, {
      result,
      updatedText: pasteL3.getText(),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/classic") {
    const body = await readBody(req);
    loop.setClassicMode(Boolean(body.enabled));
    sendJson(res, currentState());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/spec-check") {
    const script = path.join(ROOT, "scripts/spec-check.mjs");
    const out = execFileSync(process.execPath, [script], { encoding: "utf8" }).trim();
    sendJson(res, { ok: true, output: out });
    return;
  }

  sendJson(res, { error: "Not found" }, 404);
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`Clippie demo stage listening on http://127.0.0.1:${PORT}\n`);
});
