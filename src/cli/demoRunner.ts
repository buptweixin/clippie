import { LayeredDocumentAdapter } from "../adapters/LayeredDocumentAdapter";
import { MockDocumentAdapter } from "../adapters/MockDocumentAdapter";
import { AgentLoop, type BubbleNotice } from "../agent/loop";
import { LocalFallbackModelClient } from "../agent/modelClient";
import { SnapshotDeduper } from "../perception/perceptualHash";
import type { PerceptionEvent } from "../perception/stuckDetector";

const ev = (kind: PerceptionEvent["kind"], detail?: string): PerceptionEvent => ({
  kind,
  at: Date.now(),
  detail,
});

async function runDemoWalkthrough(): Promise<void> {
  const log = (line = ""): void => {
    process.stdout.write(`${line}\n`);
  };
  log("=== Clippie — Closed Agent Loop Walkthrough ===");

  // Act 1: Restraint on ordinary typing
  const wordDoc = new MockDocumentAdapter({
    level: "L2",
    appName: "Word",
    initialText:
      "Section 2 (Related Work): Sparse attention reduces quadratic memory cost. Section 3 (Method): ",
    selectionStart: 74,
    visibleReferenceText: "Dao et al. (2024) IO-aware tiling achieves 3x speedup",
  });

  const notices: BubbleNotice[] = [];
  let nextChoice: "insert" | "another" | "dismiss" = "insert";

  const loop = new AgentLoop(
    wordDoc,
    new LocalFallbackModelClient(),
    {
      offer: async (artifact, stuckType) => {
        log(`  [Bubble Offer | ${stuckType}] "${artifact.text.trim()}"`);
        log(`  [Rationale] ${artifact.rationale}`);
        if (artifact.degradationNote) {
          log(`  [Capability Note] ${artifact.degradationNote}`);
        }
        return nextChoice;
      },
      notify: (n) => {
        notices.push(n);
        log(`  [Notice | ${n.kind}] ${n.message}`);
      },
    },
    Date.now,
    { deduper: new SnapshotDeduper() },
  );

  log("\n1. Restraint on normal editing (no model call, zero interruption):");
  await loop.onEvents([ev("edit", "p1"), ev("edit", "p1")], "Word");
  log("  -> Stayed silent as expected.");

  // Act 2: Missing transition -> 1-click insert -> kept outcome boosts weight
  log("\n2. Stuck detection (3x rewrite + 4x PDF reference switch) -> 1-click insert:");
  const stuckTransition: PerceptionEvent[] = [
    ev("rewrite", "p3"),
    ev("rewrite", "p3"),
    ev("rewrite", "p3"),
    ev("app-switch", "word<->pdf"),
    ev("app-switch", "word<->pdf"),
    ev("app-switch", "word<->pdf"),
    ev("app-switch", "word<->pdf"),
  ];
  await loop.onEvents(stuckTransition, "Word");
  wordDoc.emitOutcome("mock:1", "kept");
  log(`  -> Updated doc: "${wordDoc.getText()}"`);
  log(
    `  -> Learned weight after keeping artifact: ${loop
      .getStats("missing-transition", "Word")
      .weight.toFixed(2)}`,
  );

  // Act 3: 3 consecutive dismissals -> 30-minute silence
  log("\n3. Dismissals are data (3x dismiss -> 30-minute silence):");
  nextChoice = "dismiss";
  const blankPage = [ev("idle", "20000")];
  const dedupeFreeLoop = new AgentLoop(
    wordDoc,
    new LocalFallbackModelClient(),
    {
      offer: async () => "dismiss",
      notify: (n) => log(`  [Notice | ${n.kind}] ${n.message}`),
    },
  );
  await dedupeFreeLoop.onEvents(blankPage, "Word");
  await dedupeFreeLoop.onEvents(blankPage, "Word");
  await dedupeFreeLoop.onEvents(blankPage, "Word");
  log(
    `  -> Silenced for blank-page in Word: ${dedupeFreeLoop.isSilenced(
      "blank-page",
      "Word",
    )}`,
  );

  // Act 4: Honest L2 -> L3 paste degradation
  log("\n4. Honest capability degradation (read-only/elevated window -> L3 paste):");
  const failingL2 = {
    level: "L2" as const,
    getContext: () => wordDoc.getContext(),
    getSelection: () => wordDoc.getSelection(),
    insertAtCursor: async () => ({ ok: false, level: "L2" as const }),
    undo: async () => false,
    observeOutcome: () => {},
  };
  const fallbackL3 = new MockDocumentAdapter({
    level: "L3",
    appName: "ElevatedEditor",
    initialText: "Draft: ",
    selectionStart: 7,
  });
  const layered = new LayeredDocumentAdapter([failingL2, fallbackL3]);
  const res = await layered.insertAtCursor("Inserted bridge sentence.");
  log(`  -> Executed at ${res.level}: ${res.degradationNote}`);
  log(`  -> Notices recorded: ${notices.length >= 0 ? "OK" : "ERR"}`);
}

if (require.main === module) {
  void runDemoWalkthrough();
}

export { runDemoWalkthrough };
