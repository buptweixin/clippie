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

  it("detects blank-page paralysis", () => {
    const hit = detectStuck([ev("idle", "20000")]);
    expect(hit?.type).toBe("blank-page");
  });

  it("detects a missing transition from rewrites + reference bouncing", () => {
    const events = [
      ev("rewrite", "p4"), ev("rewrite", "p4"), ev("rewrite", "p4"),
      ev("app-switch"), ev("app-switch"), ev("app-switch"), ev("app-switch"),
    ];
    expect(detectStuck(events)?.type).toBe("missing-transition");
  });
});
