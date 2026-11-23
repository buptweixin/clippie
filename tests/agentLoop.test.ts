import { describe, expect, it, vi } from "vitest";
import { AgentLoop, type Bubble, type BubbleNotice, type ModelClient } from "../src/agent/loop";
import { MockDocumentAdapter } from "../src/adapters/MockDocumentAdapter";
import { SnapshotDeduper } from "../src/perception/perceptualHash";
import type { PerceptionEvent } from "../src/perception/stuckDetector";

const ev = (kind: PerceptionEvent["kind"], detail?: string): PerceptionEvent => ({
  kind,
  at: 1_000,
  detail,
});

const transitionEvents: PerceptionEvent[] = [
  ev("rewrite", "p4"),
  ev("rewrite", "p4"),
  ev("rewrite", "p4"),
  ev("app-switch", "docs<->pdf"),
  ev("app-switch", "docs<->pdf"),
  ev("app-switch", "docs<->pdf"),
  ev("app-switch", "docs<->pdf"),
];

describe("AgentLoop end-to-end", () => {
  it("stays silent on ordinary editing without calling the model", async () => {
    const adapter = new MockDocumentAdapter({ initialText: "Drafting..." });
    const proposeArtifact = vi.fn();
    const offer = vi.fn();
    const loop = new AgentLoop(
      adapter,
      { proposeArtifact },
      { offer },
    );

    await loop.onEvents([ev("edit", "p1"), ev("edit", "p1")]);

    expect(proposeArtifact).not.toHaveBeenCalled();
    expect(offer).not.toHaveBeenCalled();
    expect(adapter.getText()).toBe("Drafting...");
  });

  it("inserts offered artifact at cursor and boosts weight when kept", async () => {
    const adapter = new MockDocumentAdapter({
      appName: "Word",
      initialText: "Related work ends here. Method starts here.",
      selectionStart: 24,
      visibleReferenceText: "Smith et al. (2025) introduced sparse attention.",
    });

    const model: ModelClient = {
      proposeArtifact: vi.fn(async ({ stuckType, referenceText }) => ({
        text: `Building on ${referenceText ? "Smith et al. (2025)" : "prior work"}, `,
        rationale: `Detected ${stuckType} between Related Work and Method.`,
      })),
    };
    const bubble: Bubble = {
      offer: vi.fn(async () => "insert"),
    };

    const loop = new AgentLoop(adapter, model, bubble);
    await loop.onEvents(transitionEvents, "Word");

    expect(adapter.getText()).toBe(
      "Related work ends here. Building on Smith et al. (2025), Method starts here.",
    );

    // Simulate positive outcome ("kept")
    adapter.emitOutcome("mock:1", "kept");
    expect(loop.getStats("missing-transition", "Word").weight).toBeCloseTo(1.1, 5);
  });

  it("regenerates artifact on 'another' and inserts the chosen revision", async () => {
    const adapter = new MockDocumentAdapter({
      appName: "GoogleDocs",
      initialText: "Intro. ",
      selectionStart: 7,
    });

    const proposeArtifact = vi.fn(async ({ attempt }) => ({
      text: attempt === 1 ? "First draft." : "Second tighter draft.",
      rationale: "Bridge",
    }));
    const offer = vi
      .fn<Bubble["offer"]>()
      .mockResolvedValueOnce("another")
      .mockResolvedValueOnce("insert");

    const loop = new AgentLoop(adapter, { proposeArtifact }, { offer });
    await loop.onEvents(transitionEvents, "GoogleDocs");

    expect(proposeArtifact).toHaveBeenCalledTimes(2);
    expect(proposeArtifact.mock.calls[1][0].previousTexts).toEqual(["First draft."]);
    expect(adapter.getText()).toBe("Intro. Second tighter draft.");
  });

  it("silences a stuck type for 30 minutes after 3 consecutive dismissals and notifies", async () => {
    let now = 1_000_000;
    const adapter = new MockDocumentAdapter({ appName: "Word", initialText: "" });
    const notices: BubbleNotice[] = [];
    const model: ModelClient = {
      proposeArtifact: vi.fn(async () => ({
        text: "Suggested outline",
        rationale: "Blank page",
      })),
    };
    const bubble: Bubble = {
      offer: vi.fn(async () => "dismiss"),
      notify: (n) => {
        notices.push(n);
      },
    };

    const loop = new AgentLoop(adapter, model, bubble, () => now);
    const blankEvents = [ev("idle", "20000")];

    await loop.onEvents(blankEvents, "Word");
    await loop.onEvents(blankEvents, "Word");
    await loop.onEvents(blankEvents, "Word");

    expect(loop.isSilenced("blank-page", "Word")).toBe(true);
    expect(notices).toHaveLength(1);
    expect(notices[0].kind).toBe("silenced");
    expect(notices[0].message).toContain("30 minutes");

    // During silence window, model is never called; other apps remain unaffected.
    await loop.onEvents(blankEvents, "Word");
    expect(model.proposeArtifact).toHaveBeenCalledTimes(3);

    await loop.onEvents(blankEvents, "VSCode");
    expect(model.proposeArtifact).toHaveBeenCalledTimes(4);

    // Classic mode overrides silence and threshold for demo/nostalgia.
    loop.setClassicMode(true);
    await loop.onEvents(blankEvents, "Word");
    expect(model.proposeArtifact).toHaveBeenCalledTimes(5);

    // After 30 minutes with classic mode off, silence expires (though weight is reduced).
    loop.setClassicMode(false);
    now += 30 * 60_000 + 1;
    expect(loop.isSilenced("blank-page", "Word")).toBe(false);
  });

  it("lowers weight on deleted outcome and surfaces L3 degradation notice", async () => {
    const adapter = new MockDocumentAdapter({
      appName: "AdminApp",
      level: "L3",
      initialText: "Text ",
      selectionStart: 5,
    });
    const notices: BubbleNotice[] = [];
    const loop = new AgentLoop(
      adapter,
      {
        proposeArtifact: async () => ({ text: "Bridge.", rationale: "Transition" }),
      },
      {
        offer: async (artifact) => {
          expect(artifact.degradationNote).toContain("paste");
          return "insert";
        },
        notify: (n) => {
          notices.push(n);
        },
      },
    );

    await loop.onEvents(transitionEvents, "AdminApp");
    expect(notices.some((n) => n.kind === "degraded")).toBe(true);

    adapter.emitOutcome("mock:1", "deleted");
    expect(loop.getStats("missing-transition", "AdminApp").weight).toBeCloseTo(0.7, 5);
  });

  it("deduplicates near-identical trigger snapshots and prevents concurrent re-entry", async () => {
    const adapter = new MockDocumentAdapter({
      appName: "Word",
      initialText: "Section 2 draft.",
    });
    let currentHash = "00ff00ff00ff00ff";
    let resolveOffer: ((c: "insert" | "another" | "dismiss") => void) | null = null;

    const proposeArtifact = vi.fn(async ({ referenceText, imageCropBase64 }) => ({
      text: `Bridge (${referenceText}, ${imageCropBase64})`,
      rationale: "Snapshot test",
    }));

    const loop = new AgentLoop(
      adapter,
      { proposeArtifact },
      {
        offer: () =>
          new Promise((resolve) => {
            resolveOffer = resolve;
          }),
      },
      Date.now,
      {
        deduper: new SnapshotDeduper({ maxHammingDistance: 4 }),
        snapshotProvider: {
          captureSnapshot: async () => ({
            ocrText: "PDF excerpt",
            imageCropBase64: "JPEG_CROP",
            dHashHex: currentHash,
          }),
        },
      },
    );

    const firstRun = loop.onEvents(transitionEvents, "Word");
    await vi.waitFor(() => expect(resolveOffer).not.toBeNull());
    expect(loop.isBusy()).toBe(true);

    // Concurrent trigger while offer is open is ignored
    await loop.onEvents(transitionEvents, "Word");
    expect(proposeArtifact).toHaveBeenCalledTimes(1);

    const resolveFirst = resolveOffer!;
    resolveOffer = null;
    resolveFirst("insert");
    await firstRun;
    expect(loop.isBusy()).toBe(false);

    // Near-identical snapshot (1 bit diff) is suppressed by SnapshotDeduper
    currentHash = "00ff00ff00ff00fe";
    await loop.onEvents(transitionEvents, "Word");
    expect(proposeArtifact).toHaveBeenCalledTimes(1);

    // Distinct snapshot (> 4 bits diff) triggers a fresh model call
    currentHash = "ffff0000ffff0000";
    const thirdRun = loop.onEvents(transitionEvents, "Word");
    await vi.waitFor(() => expect(resolveOffer).not.toBeNull());
    expect(proposeArtifact).toHaveBeenCalledTimes(2);
    resolveOffer!("dismiss");
    await thirdRun;
  });
});
