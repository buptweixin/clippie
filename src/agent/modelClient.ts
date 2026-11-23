import type { Artifact, ModelClient, ProposeArtifactInput } from "./loop";

const SYSTEM_PROMPT = [
  "You are Clippie, a restrained multimodal writing companion.",
  "HARD PRODUCT RULES:",
  "1. Return ONLY valid JSON matching: {\"text\": string, \"rationale\": string}.",
  "2. `text` MUST be a finished, directly insertable document artifact (e.g. a two-sentence bridge, citation sentence, concise summary, or Markdown/prose section outline).",
  "3. NEVER output conversational filler or advice like 'Here is a draft' or 'You could try...'. `text` is spliced straight into the user's cursor.",
  "4. `rationale` is one short sentence (< 90 chars) explaining why this artifact fits.",
].join("\n");

export interface OpenAICompatibleConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  fallback?: ModelClient;
}

/**
 * Remote multimodal VLM client speaking OpenAI-compatible `/chat/completions`.
 * Sends only the semantic snapshot (context text + optional reference OCR +
 * optional low-res active-window JPEG crop).
 */
export class OpenAICompatibleModelClient implements ModelClient {
  private baseUrl: string;
  private model: string;
  private timeoutMs: number;
  private fetchImpl: typeof fetch;

  constructor(private config: OpenAICompatibleConfig) {
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    this.model = config.model ?? "gpt-4o-mini";
    this.timeoutMs = config.timeoutMs ?? 12_000;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async proposeArtifact(input: ProposeArtifactInput): Promise<Artifact> {
    const userPrompt = buildUserPrompt(input);
    const content: Array<Record<string, unknown>> = [
      { type: "text", text: userPrompt },
    ];

    if (input.imageCropBase64) {
      const url = input.imageCropBase64.startsWith("data:")
        ? input.imageCropBase64
        : `data:image/jpeg;base64,${input.imageCropBase64}`;
      content.push({
        type: "image_url",
        image_url: { url, detail: "low" },
      });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: input.attempt && input.attempt > 1 ? 0.8 : 0.4,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content },
          ],
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Model HTTP ${res.status}`);
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const raw = data.choices?.[0]?.message?.content ?? "";
      return parseArtifactJSON(raw);
    } catch (err) {
      if (this.config.fallback) {
        return this.config.fallback.proposeArtifact(input);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

function buildUserPrompt(input: ProposeArtifactInput): string {
  const lines = [
    `Stuck type: ${input.stuckType}`,
    `Text before cursor:\n${input.context || "(empty document)"}`,
  ];
  if (input.referenceText) {
    lines.push(`Visible reference material (OCR):\n${input.referenceText}`);
  }
  if (input.previousTexts && input.previousTexts.length > 0) {
    lines.push(
      `Previous versions rejected by user (write a distinctly different angle):\n${input.previousTexts
        .map((t, i) => `${i + 1}. ${t}`)
        .join("\n")}`,
    );
  }
  return lines.join("\n\n");
}

export function parseArtifactJSON(raw: string): Artifact {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const parsed = JSON.parse(trimmed) as { text?: unknown; rationale?: unknown };
  if (typeof parsed.text !== "string" || !parsed.text.trim()) {
    throw new Error("Model response missing non-empty `text` field");
  }
  return {
    text: parsed.text,
    rationale:
      typeof parsed.rationale === "string" && parsed.rationale.trim()
        ? parsed.rationale.trim()
        : "Drafted from current document context.",
  };
}

/**
 * Deterministic local ModelClient for offline demos, development without API
 * keys, and resilient fallback when remote calls time out.
 */
export class LocalFallbackModelClient implements ModelClient {
  async proposeArtifact(input: ProposeArtifactInput): Promise<Artifact> {
    const attempt = input.attempt ?? 1;
    const refSnippet = extractKeyPhrase(input.referenceText);

    switch (input.stuckType) {
      case "blank-page": {
        const variants = [
          "## Problem Statement\n\n## Core Approach\n\n## Evaluation Plan\n",
          "1. Context & Motivation\n2. Key Design Decisions\n3. Expected Outcomes\n",
          "### Goal\nState the single outcome this document must establish.\n\n### Next Steps\n- \n",
        ];
        return {
          text: variants[(attempt - 1) % variants.length],
          rationale: "Starter structure to break blank-page paralysis.",
        };
      }
      case "missing-transition": {
        const cite = refSnippet ? ` (${refSnippet})` : " [citation]";
        const variants = [
          `Building on these prior findings${cite}, our method addresses the remaining gap directly. Specifically, we introduce `,
          `While earlier approaches establish the baseline${cite}, they leave open a key bottleneck that our design resolves below. `,
          `Taken together, the evidence above${cite} motivates a more targeted mechanism: `,
        ];
        return {
          text: variants[(attempt - 1) % variants.length],
          rationale: "Two-sentence bridge linking current section to reference.",
        };
      }
      case "missing-citation": {
        const cite = refSnippet ? `[${refSnippet}]` : "[Author, Year]";
        const variants = [
          `Prior work demonstrates this effect empirically ${cite}. `,
          `Consistent with established results ${cite}, `,
          `As reported in ${cite}, `,
        ];
        return {
          text: variants[(attempt - 1) % variants.length],
          rationale: " anchored claim with citation placeholder.",
        };
      }
      case "needs-summary": {
        const summary = refSnippet
          ? `In summary, the referenced passage highlights ${refSnippet}, which directly informs our discussion here. `
          : "In summary, the referenced passage establishes the key constraint we build upon next. ";
        return {
          text:
            attempt > 1
              ? `Key takeaway: ${refSnippet ?? "the source establishes the baseline assumptions used below"}. `
              : summary,
          rationale: "Concise synthesis of the dwelled reference passage.",
        };
      }
      case "no-outline": {
        const variants = [
          "\n### 1. Background\n### 2. Proposed Mechanism\n### 3. Discussion & Limitations\n",
          "\n- **Claim:** \n- **Evidence:** \n- **Implication:** \n",
        ];
        return {
          text: variants[(attempt - 1) % variants.length],
          rationale: "Section skeleton to organize scattered edits.",
        };
      }
    }
  }
}

function extractKeyPhrase(ref?: string): string | undefined {
  if (!ref) return undefined;
  const firstLine = ref.trim().split(/\r?\n/)[0]?.trim();
  if (!firstLine) return undefined;
  const firstSentence = firstLine.split(/(?<!\bet al)[.!?]\s+/i)[0]?.trim() ?? firstLine;
  const clean = firstSentence.replace(/[.!?]+$/, "");
  if (!clean) return undefined;
  return clean.length > 60
    ? `${clean.slice(0, 57).trimEnd()}...`
    : clean;
}

export function createDefaultModelClient(
  env: Record<string, string | undefined> = process.env,
): ModelClient {
  const fallback = new LocalFallbackModelClient();
  const apiKey = env.CLIPPIE_API_KEY ?? env.OPENAI_API_KEY;
  if (!apiKey) {
    return fallback;
  }
  return new OpenAICompatibleModelClient({
    apiKey,
    baseUrl: env.CLIPPIE_API_BASE_URL ?? env.OPENAI_BASE_URL,
    model: env.CLIPPIE_MODEL,
    fallback,
  });
}
