import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { runDemoWalkthrough } from "../src/cli/demoRunner";
import { createPlatformRuntime } from "../src/main/runtime";

describe("Platform runtime & Kiro spec-check", () => {
  it("falls back cleanly to MockDocumentAdapter when no native binary exists", async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "clippie-runtime-"));
    try {
      const rt = createPlatformRuntime(emptyDir, "darwin");
      expect(rt.adapter.level).toBe("L1");
      expect(rt.snapshotProvider).toBeUndefined();
      await rt.close();
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("runs the 4-act closed-loop demo walkthrough without errors", async () => {
    const chunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await runDemoWalkthrough();
    } finally {
      process.stdout.write = origWrite;
    }

    const output = chunks.join("");
    expect(output).toContain("Learned weight after keeping artifact: 1.10");
    expect(output).toContain("Silenced for blank-page in Word: true");
    expect(output).toContain("Executed at L3:");
  });

  it("passes scripts/spec-check.mjs enforcing .kiro/specs and .kiro/steering invariants", () => {
    const script = path.resolve(__dirname, "../scripts/spec-check.mjs");
    const out = execFileSync(process.execPath, [script], { encoding: "utf8" });
    expect(out).toContain("[spec-check OK]");
  });
});
