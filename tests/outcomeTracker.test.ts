import { describe, expect, it } from "vitest";
import { OutcomeObserver, classifyEditOutcome } from "../src/perception/outcomeTracker";

describe("outcomeTracker", () => {
  const inserted =
    "Building on Smith et al. (2025), our method resolves the memory bottleneck directly.";

  it("classifies intact or written-past insertions as kept", () => {
    const doc = `Prior section. ${inserted} Next we formalize the attention kernel.`;
    expect(classifyEditOutcome(inserted, doc)).toBe("kept");
  });

  it("classifies partially rewritten insertions as edited", () => {
    const doc =
      "Prior section. Following Smith et al., our approach addresses the memory bottleneck via tiling.";
    expect(classifyEditOutcome(inserted, doc)).toBe("edited");
  });

  it("classifies removed insertions as deleted", () => {
    const doc = "Prior section. Completely unrelated paragraph here.";
    expect(classifyEditOutcome(inserted, doc)).toBe("deleted");
  });

  it("evaluates outcome asynchronously when scheduled window fires", async () => {
    let scheduledFn: (() => void) | null = null;
    const observer = new OutcomeObserver({
      windowMs: 30_000,
      schedule: (fn) => {
        scheduledFn = fn;
      },
    });

    const outcomePromise = new Promise<string>((resolve) => {
      observer.watch(
        inserted,
        async () => `Intro. ${inserted} Continuation.`,
        (o) => resolve(o),
      );
    });

    expect(scheduledFn).not.toBeNull();
    scheduledFn!();
    expect(await outcomePromise).toBe("kept");
  });
});
