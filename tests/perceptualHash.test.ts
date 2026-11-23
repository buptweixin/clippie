import { describe, expect, it } from "vitest";
import {
  SnapshotDeduper,
  computeDHashFromGrayscale,
  computeTextSimHash,
  formatHashHex,
  hammingDistance64,
  parseHashHex,
  rgbaToGrayscale,
} from "../src/perception/perceptualHash";

function makeGradientGray(width: number, height: number, invert = false): Uint8Array {
  const buf = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = Math.floor(((x + y * 0.3) / (width + height * 0.3)) * 255);
      buf[y * width + x] = invert ? 255 - v : v;
    }
  }
  return buf;
}

describe("perceptualHash & SnapshotDeduper", () => {
  it("computes stable 64-bit dHash and distinguishes distinct images", () => {
    const imgA = makeGradientGray(36, 32, false);
    const imgSlightlyNoisy = new Uint8Array(imgA);
    imgSlightlyNoisy[10] = Math.min(255, imgSlightlyNoisy[10] + 2);
    const imgInverted = makeGradientGray(36, 32, true);

    const hashA = computeDHashFromGrayscale(imgA, 36, 32);
    const hashNoisy = computeDHashFromGrayscale(imgSlightlyNoisy, 36, 32);
    const hashInv = computeDHashFromGrayscale(imgInverted, 36, 32);

    expect(hammingDistance64(hashA, hashNoisy)).toBeLessThanOrEqual(2);
    expect(hammingDistance64(hashA, hashInv)).toBeGreaterThan(30);

    const hex = formatHashHex(hashA);
    expect(hex).toHaveLength(16);
    expect(parseHashHex(hex)).toBe(hashA);
  });

  it("converts RGBA buffers to grayscale accurately", () => {
    const rgba = new Uint8Array([
      255, 255, 255, 255,
      0, 0, 0, 255,
    ]);
    const gray = rgbaToGrayscale(rgba, 2, 1);
    expect(gray[0]).toBeGreaterThan(250);
    expect(gray[1]).toBe(0);
  });

  it("suppresses near-duplicate snapshots within TTL per app scope", () => {
    let now = 10_000;
    const deduper = new SnapshotDeduper({
      maxHammingDistance: 5,
      ttlMs: 60_000,
      now: () => now,
    });

    const h1 = computeTextSimHash("Section 2: Related Work on sparse attention in transformers.");
    const hNear = computeTextSimHash("Section 2: Related Work on sparse attention in transformers!");
    const hDifferent = computeTextSimHash("Appendix B: Hyperparameter sweep table and learning rate schedule.");

    expect(deduper.checkAndRecord("Word", h1).duplicate).toBe(false);
    expect(deduper.checkAndRecord("Word", hNear).duplicate).toBe(true);

    // Different app scope is independent
    expect(deduper.checkAndRecord("GoogleDocs", hNear).duplicate).toBe(false);

    // Distinct text passes through immediately
    expect(deduper.checkAndRecord("Word", hDifferent).duplicate).toBe(false);

    // Same text after TTL expires is allowed again
    now += 61_000;
    expect(deduper.checkAndRecord("Word", hDifferent).duplicate).toBe(false);
  });
});
