/**
 * Stuck-state detection from observable signals only.
 *
 * No model call happens here — this is cheap local logic over an event
 * window. It either fires with a classification and a confidence, or it
 * stays silent. Silence is the default and the brand.
 */

export type StuckType =
  | "blank-page"
  | "missing-transition"
  | "missing-citation"
  | "needs-summary"
  | "no-outline";

export interface PerceptionEvent {
  kind:
    | "idle" // no input while a document is focused
    | "rewrite" // the same sentence/paragraph edited again
    | "app-switch" // focus moved between apps/windows
    | "selection-dwell" // a passage stayed selected/visible a long time
    | "edit"; // any document edit
  at: number; // epoch ms
  /** e.g. paragraph id, app pair "docs<->pdf" */
  detail?: string;
}

export interface StuckDetection {
  type: StuckType;
  confidence: number; // 0..1
}

const IDLE_MS = 20_000;
const REWRITES = 3;
const SWITCHES = 4;

export function detectStuck(events: PerceptionEvent[]): StuckDetection | null {
  const by = (k: PerceptionEvent["kind"]) => events.filter((e) => e.kind === k);

  // Blank page: long idle with (almost) no edits in the window.
  const idle = by("idle").some((e) => {
    const ms = Number(e.detail);
    return Number.isFinite(ms) && ms >= IDLE_MS;
  });
  const edits = by("edit");
  if (idle && edits.length <= 1) {
    return { type: "blank-page", confidence: 0.75 };
  }

  // Same paragraph rewritten repeatedly + bouncing to a reference:
  // the classic missing-transition / missing-citation pattern.
  const rewrites = by("rewrite");
  const sameSpot = rewrites.some(
    (r) => rewrites.filter((x) => x.detail === r.detail).length >= REWRITES,
  );
  const bouncing = by("app-switch").length >= SWITCHES;
  if (sameSpot && bouncing) {
    return { type: "missing-transition", confidence: 0.82 };
  }
  if (sameSpot) {
    return { type: "missing-citation", confidence: 0.6 };
  }

  // Long dwell on a passage in another window: offer a summary of it.
  if (by("selection-dwell").length >= 2) {
    return { type: "needs-summary", confidence: 0.65 };
  }

  // Scattered edits across multiple paragraphs with repeated pauses:
  // suggests the writer lacks a clear section outline.
  const distinctSpots = new Set(edits.map((e) => e.detail).filter(Boolean));
  const pauses = by("idle").length + by("selection-dwell").length;
  if (edits.length >= 4 && distinctSpots.size >= 3 && pauses >= 2) {
    return { type: "no-outline", confidence: 0.7 };
  }

  return null;
}
