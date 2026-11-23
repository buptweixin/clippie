import { describe, expect, it, vi } from "vitest";
import {
  LocalFallbackModelClient,
  OpenAICompatibleModelClient,
  parseArtifactJSON,
} from "../src/agent/modelClient";

describe("ModelClient implementations", () => {
  it("parses plain and fenced JSON artifacts", () => {
    expect(
      parseArtifactJSON('```json\n{"text":"Bridge.","rationale":"Links sections"}\n```'),
    ).toEqual({
      text: "Bridge.",
      rationale: "Links sections",
    });
  });

  it("sends semantic snapshot + image crop to OpenAI-compatible vision endpoint", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("gpt-4o-mini");
      const userMsg = body.messages[1];
      expect(userMsg.content).toHaveLength(2);
      expect(userMsg.content[1].image_url.url).toBe("data:image/jpeg;base64,AAAA");
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  text: "Building on Jones (2024), we propose X.",
                  rationale: "Connects related work to method.",
                }),
              },
            },
          ],
        }),
        { status: 200 },
      );
    });

    const client = new OpenAICompatibleModelClient({
      apiKey: "test-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const artifact = await client.proposeArtifact({
      stuckType: "missing-transition",
      context: "Jones (2024) studied Y.",
      referenceText: "Jones 2024 PDF excerpt",
      imageCropBase64: "AAAA",
    });

    expect(artifact.text).toBe("Building on Jones (2024), we propose X.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back cleanly to LocalFallbackModelClient when remote HTTP fails", async () => {
    const fallback = new LocalFallbackModelClient();
    const client = new OpenAICompatibleModelClient({
      apiKey: "test-key",
      fallback,
      fetchImpl: (async () => new Response("error", { status: 503 })) as typeof fetch,
    });

    const a1 = await client.proposeArtifact({
      stuckType: "missing-transition",
      context: "Draft",
      referenceText: "Smith et al. 2025",
      attempt: 1,
    });
    const a2 = await fallback.proposeArtifact({
      stuckType: "missing-transition",
      context: "Draft",
      referenceText: "Smith et al. 2025",
      attempt: 2,
    });

    expect(a1.text).toContain("Smith et al. 2025");
    expect(a2.text).not.toBe(a1.text);
  });
});
