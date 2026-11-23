import type { InsertOutcome } from "../adapters/DocumentAdapter";

/**
 * Post-insert outcome evaluation (docs/architecture.md):
 *   - kept: artifact remains substantially intact (>= 80% token retention)
 *   - edited: writer engaged and reshaped the draft (25%..80% retention)
 *   - deleted: artifact was removed or undone (< 25% retention)
 */
export function classifyEditOutcome(
  insertedText: string,
  currentDocumentText: string,
): InsertOutcome {
  const cleanInsert = insertedText.trim();
  if (!cleanInsert) return "kept";

  if (currentDocumentText.includes(cleanInsert)) {
    return "kept";
  }

  const insertTokens = tokenize(cleanInsert);
  if (insertTokens.length === 0) return "kept";

  const docTokenCounts = countTokens(tokenize(currentDocumentText));
  let matched = 0;
  for (const tok of insertTokens) {
    const available = docTokenCounts.get(tok) ?? 0;
    if (available > 0) {
      matched++;
      docTokenCounts.set(tok, available - 1);
    }
  }

  const retention = matched / insertTokens.length;
  if (retention >= 0.8) return "kept";
  if (retention >= 0.25) return "edited";
  return "deleted";
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .filter((t) => t.length > 0);
}

function countTokens(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tokens) {
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return counts;
}

export interface OutcomeWatchOptions {
  windowMs?: number;
  schedule?: (fn: () => void, delayMs: number) => unknown;
}

/**
 * Tracks pending insertions for L2/L3 adapters and evaluates whether the user
 * kept, edited, or deleted the inserted text once the observation window elapses.
 */
export class OutcomeObserver {
  private windowMs: number;
  private schedule: (fn: () => void, delayMs: number) => unknown;

  constructor(options: OutcomeWatchOptions = {}) {
    this.windowMs = options.windowMs ?? 30_000;
    this.schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  }

  watch(
    insertedText: string,
    readCurrentDocumentText: () => Promise<string>,
    onOutcome: (outcome: InsertOutcome) => void,
  ): void {
    this.schedule(() => {
      void readCurrentDocumentText()
        .then((docText) => {
          onOutcome(classifyEditOutcome(insertedText, docText));
        })
        .catch(() => {
          // If the window closed or switched away, do not penalize weights.
        });
    }, this.windowMs);
  }
}
