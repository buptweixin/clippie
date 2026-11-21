import { describe, expect, it } from "vitest";
import { detectStuck, type PerceptionEvent } from "../src/perception/stuckDetector";

const ev = (kind: PerceptionEvent["kind"], detail?: string): PerceptionEvent => ({
  kind,
  at: Date.now(),
  detail,
});

describe("detectStuck", () => {
  it("stays silent on ordinary editing", () => {
    expect(detectStuck([ev("edit"), ev("edit"), ev("app-switch")])).toBeNull();
  });

  it("detects blank-page paralysis for idle >= 20000ms", () => {
    expect(detectStuck([ev("idle", "20000")])?.type).toBe("blank-page");
    expect(detectStuck([ev("idle", "25000")])?.type).toBe("blank-page");
  });

  it("detects a missing transition from rewrites + reference bouncing", () => {
    const events = [
      ev("rewrite", "p4"), ev("rewrite", "p4"), ev("rewrite", "p4"),
      ev("app-switch"), ev("app-switch"), ev("app-switch"), ev("app-switch"),
    ];
    expect(detectStuck(events)?.type).toBe("missing-transition");
  });

  it("detects missing citation on repeated rewrites without bouncing", () => {
    const events = [ev("rewrite", "p2"), ev("rewrite", "p2"), ev("rewrite", "p2")];
    expect(detectStuck(events)?.type).toBe("missing-citation");
  });

  it("detects needs-summary on repeated selection dwells", () => {
    const events = [ev("selection-dwell", "pdf"), ev("selection-dwell", "pdf")];
    expect(detectStuck(events)?.type).toBe("needs-summary");
  });

  it("detects no-outline on scattered edits with pauses", () => {
    const events = [
      ev("edit", "p1"),
      ev("edit", "p3"),
      ev("idle", "5000"),
      ev("edit", "p2"),
      ev("edit", "p5"),
      ev("selection-dwell", "doc"),
    ];
    expect(detectStuck(events)?.type).toBe("no-outline");
  });
});
