import { detectStuck, type PerceptionEvent, type StuckType } from "../perception/stuckDetector";
import type { DocumentAdapter, InsertOutcome } from "../adapters/DocumentAdapter";

/**
 * The agent loop: observe → decide → act → learn.
 *
 * - observe: pull a semantic snapshot (context + reference text) — only
 *   after the local stuck detector fires, never on a timer against the LLM.
 * - decide: confidence + per-type feedback weights + silence window.
 * - act: ask the model for ONE finished artifact and offer it in the bubble.
 * - learn: the user's keep/edit/delete/dismiss behaviour tunes the weights.
 */

export interface Artifact {
  text: string;
  rationale: string;
}

export interface ModelClient {
  proposeArtifact(input: {
    stuckType: StuckType;
    context: string;
    referenceText?: string;
  }): Promise<Artifact>;
}

export interface Bubble {
  offer(artifact: Artifact, stuckType: StuckType): Promise<"insert" | "another" | "dismiss">;
}

interface TypeStats {
  weight: number; // starts at 1, moves with feedback
  consecutiveDismissals: number;
  silencedUntil: number;
}

const BASE_THRESHOLD = 0.6;
const SILENCE_MS = 30 * 60_000;

export class AgentLoop {
  private stats = new Map<StuckType, TypeStats>();

  constructor(
    private adapter: DocumentAdapter,
    private model: ModelClient,
    private bubble: Bubble,
    private now: () => number = Date.now,
  ) {}

  private stat(t: StuckType): TypeStats {
    let s = this.stats.get(t);
    if (!s) {
      s = { weight: 1, consecutiveDismissals: 0, silencedUntil: 0 };
      this.stats.set(t, s);
    }
    return s;
  }

  /** Feed one window of perception events; acts only if warranted. */
  async onEvents(events: PerceptionEvent[]): Promise<void> {
    const hit = detectStuck(events);
    if (!hit) return;

    const s = this.stat(hit.type);
    if (this.now() < s.silencedUntil) return;
    if (hit.confidence * s.weight < BASE_THRESHOLD) return;

    const ctx = await this.adapter.getContext();
    const artifact = await this.model.proposeArtifact({
      stuckType: hit.type,
      context: ctx.textBeforeCursor,
      referenceText: ctx.visibleReferenceText,
    });

    const choice = await this.bubble.offer(artifact, hit.type);
    if (choice === "dismiss") {
      s.consecutiveDismissals += 1;
      s.weight *= 0.85;
      if (s.consecutiveDismissals >= 3) {
        s.silencedUntil = this.now() + SILENCE_MS;
        s.consecutiveDismissals = 0;
      }
      return;
    }
    if (choice === "another") {
      // The bubble re-offers with a regenerated artifact; the loop's job
      // here is only to not count this as a dismissal.
      return;
    }

    const result = await this.adapter.insertAtCursor(artifact.text);
    if (!result.ok || !result.undoToken) return;
    this.adapter.observeOutcome(result.undoToken, (o: InsertOutcome) => {
      if (o === "kept") {
        s.weight = Math.min(1.3, s.weight * 1.1);
        s.consecutiveDismissals = 0;
      } else if (o === "deleted") {
        s.weight *= 0.7;
      }
      // "edited" is neutral: the user engaged, the artifact was a draft.
    });
  }
}
