import { detectStuck, type PerceptionEvent, type StuckType } from "../perception/stuckDetector";
import {
  SnapshotDeduper,
  computeTextSimHash,
  parseHashHex,
} from "../perception/perceptualHash";
import type { AdapterLevel, DocumentAdapter, InsertOutcome } from "../adapters/DocumentAdapter";

/**
 * The agent loop: observe → decide → act → learn.
 *
 * - observe: pull a semantic snapshot (context + reference text + optional
 *   active-window crop) — only after the local stuck detector fires, never on
 *   a timer against the LLM.
 * - decide: confidence + per-type/per-app feedback weights + silence window +
 *   perceptual-hash snapshot deduplication + single-flight guard.
 * - act: ask the model for ONE finished artifact and offer it in the bubble.
 * - learn: the user's keep/edit/delete/dismiss behaviour tunes the weights.
 */

export interface Artifact {
  text: string;
  rationale: string;
  level?: AdapterLevel;
  degradationNote?: string;
}

export interface ProposeArtifactInput {
  stuckType: StuckType;
  context: string;
  referenceText?: string;
  imageCropBase64?: string;
  attempt?: number;
  previousTexts?: string[];
}

export interface ModelClient {
  proposeArtifact(input: ProposeArtifactInput): Promise<Artifact>;
}

export interface TriggerSnapshot {
  ocrText?: string;
  imageCropBase64?: string;
  /** 16-char hex 64-bit perceptual dHash from the OS sidecar, if available. */
  dHashHex?: string;
}

export interface SnapshotProvider {
  captureSnapshot(): Promise<TriggerSnapshot | null>;
}

export interface BubbleNotice {
  kind: "silenced" | "degraded" | "classic";
  message: string;
}

export interface Bubble {
  offer(artifact: Artifact, stuckType: StuckType): Promise<"insert" | "another" | "dismiss">;
  notify?(notice: BubbleNotice): void | Promise<void>;
}

export interface TypeStats {
  weight: number; // starts at 1, moves with feedback
  consecutiveDismissals: number;
  silencedUntil: number;
}

export interface AgentLoopOptions {
  classicMode?: boolean;
  maxRegenerations?: number;
  snapshotProvider?: SnapshotProvider;
  deduper?: SnapshotDeduper;
}

const BASE_THRESHOLD = 0.6;
const SILENCE_MS = 30 * 60_000;
const DEFAULT_MAX_REGENERATIONS = 3;

export class AgentLoop {
  private stats = new Map<string, TypeStats>();
  private classicMode: boolean;
  private maxRegenerations: number;
  private snapshotProvider?: SnapshotProvider;
  private deduper?: SnapshotDeduper;
  private globalMutedUntil = 0;
  private inFlight = false;

  constructor(
    private adapter: DocumentAdapter,
    private model: ModelClient,
    private bubble: Bubble,
    private now: () => number = Date.now,
    options: AgentLoopOptions = {},
  ) {
    this.classicMode = options.classicMode ?? false;
    this.maxRegenerations = options.maxRegenerations ?? DEFAULT_MAX_REGENERATIONS;
    this.snapshotProvider = options.snapshotProvider;
    this.deduper = options.deduper;
  }

  private statKey(appName: string, t: StuckType): string {
    return `${appName}:${t}`;
  }

  private stat(appName: string, t: StuckType): TypeStats {
    const key = this.statKey(appName, t);
    let s = this.stats.get(key);
    if (!s) {
      s = { weight: 1, consecutiveDismissals: 0, silencedUntil: 0 };
      this.stats.set(key, s);
    }
    return s;
  }

  setClassicMode(enabled: boolean): void {
    this.classicMode = enabled;
  }

  isClassicMode(): boolean {
    return this.classicMode;
  }

  isBusy(): boolean {
    return this.inFlight;
  }

  mute(durationMs: number = SILENCE_MS): void {
    this.globalMutedUntil = this.now() + durationMs;
  }

  unmute(): void {
    this.globalMutedUntil = 0;
  }

  isSilenced(t: StuckType, appName = "default"): boolean {
    if (this.classicMode) return false;
    const now = this.now();
    if (now < this.globalMutedUntil) return true;
    return now < this.stat(appName, t).silencedUntil;
  }

  getStats(t: StuckType, appName = "default"): Readonly<TypeStats> {
    return { ...this.stat(appName, t) };
  }

  /** Feed one window of perception events; acts only if warranted. */
  async onEvents(events: PerceptionEvent[], appName = "default"): Promise<void> {
    if (this.inFlight) return;
    if (!this.classicMode && this.now() < this.globalMutedUntil) return;

    const hit = detectStuck(events);
    if (!hit) return;

    const s = this.stat(appName, hit.type);
    if (!this.classicMode) {
      if (this.now() < s.silencedUntil) return;
      if (hit.confidence * s.weight < BASE_THRESHOLD) return;
    }

    this.inFlight = true;
    try {
      const ctx = await this.adapter.getContext();
      const effectiveApp = appName === "default" ? ctx.appName : appName;
      const effectiveStats = this.stat(effectiveApp, hit.type);
      if (!this.classicMode) {
        if (this.now() < effectiveStats.silencedUntil) return;
        if (hit.confidence * effectiveStats.weight < BASE_THRESHOLD) return;
      }

      const snap = (await this.snapshotProvider?.captureSnapshot()) ?? null;
      if (this.deduper) {
        const hash = snap?.dHashHex
          ? parseHashHex(snap.dHashHex)
          : computeTextSimHash(
              `${ctx.textBeforeCursor}\n${ctx.visibleReferenceText ?? snap?.ocrText ?? ""}`,
            );
        const dedupeRes = this.deduper.checkAndRecord(`${effectiveApp}:${hit.type}`, hash);
        if (dedupeRes.duplicate && !this.classicMode) {
          return;
        }
      }

      const referenceText = ctx.visibleReferenceText ?? snap?.ocrText;
      const previousTexts: string[] = [];
      let attempt = 1;
      let artifact: Artifact | null = null;
      let choice: "insert" | "another" | "dismiss" = "dismiss";

      while (attempt <= this.maxRegenerations) {
        artifact = await this.model.proposeArtifact({
          stuckType: hit.type,
          context: ctx.textBeforeCursor,
          referenceText,
          imageCropBase64: snap?.imageCropBase64,
          attempt,
          previousTexts: previousTexts.length > 0 ? [...previousTexts] : undefined,
        });

        const offered: Artifact = {
          ...artifact,
          level: artifact.level ?? this.adapter.level,
          degradationNote:
            artifact.degradationNote ??
            (this.adapter.level === "L3"
              ? "Will insert by paste — this window doesn't expose a writable accessibility tree."
              : undefined),
        };

        choice = await this.bubble.offer(offered, hit.type);
        if (choice !== "another") break;

        previousTexts.push(artifact.text);
        attempt += 1;
      }

      if (choice === "dismiss") {
        effectiveStats.consecutiveDismissals += 1;
        if (effectiveStats.consecutiveDismissals >= 3) {
          effectiveStats.weight *= 0.85;
          effectiveStats.silencedUntil = this.now() + SILENCE_MS;
          effectiveStats.consecutiveDismissals = 0;
          await this.bubble.notify?.({
            kind: "silenced",
            message: `Going quiet for 30 minutes on "${hit.type}" in ${effectiveApp}.`,
          });
        } else {
          effectiveStats.weight *= 0.9;
        }
        return;
      }

      if (choice === "another" || !artifact) {
        return;
      }

      const result = await this.adapter.insertAtCursor(artifact.text);
      if (!result.ok) return;

      if (result.degradationNote) {
        await this.bubble.notify?.({
          kind: "degraded",
          message: result.degradationNote,
        });
      }

      if (!result.undoToken) return;
      this.adapter.observeOutcome(result.undoToken, (o: InsertOutcome) => {
        if (o === "kept") {
          effectiveStats.weight = Math.min(1.3, effectiveStats.weight * 1.1);
          effectiveStats.consecutiveDismissals = 0;
        } else if (o === "deleted") {
          effectiveStats.weight *= 0.7;
        }
        // "edited" is neutral: the user engaged, the artifact was a draft.
      });
    } finally {
      this.inFlight = false;
    }
  }
}
