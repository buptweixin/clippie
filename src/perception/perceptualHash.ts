/**
 * Perceptual hashing & snapshot deduplication (Milestone 3).
 *
 * Ensures near-identical active-window snapshots never trigger redundant
 * remote VLM calls:
 *   - 64-bit 9x8 horizontal gradient dHash for grayscale/RGBA image buffers
 *   - 64-bit 3-gram SimHash fallback for text-only / OCR semantic snapshots
 *   - Per-app sliding window deduper using Hamming distance
 */

const MASK_64 = 0xffffffffffffffffn;

/** Convert RGBA buffer (4 bytes/pixel) to single-channel BT.601 luma. */
export function rgbaToGrayscale(
  rgba: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const total = width * height;
  if (rgba.length < total * 4) {
    throw new RangeError(`Expected at least ${total * 4} RGBA bytes, got ${rgba.length}`);
  }
  const gray = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    // Fast integer BT.601 approximation: (77*R + 150*G + 29*B) >> 8
    gray[i] = (77 * rgba[o] + 150 * rgba[o + 1] + 29 * rgba[o + 2]) >> 8;
  }
  return gray;
}

/**
 * Compute a 64-bit difference hash (dHash) by box-sampling a grayscale image
 * onto a 9x8 grid and comparing adjacent horizontal cells.
 */
export function computeDHashFromGrayscale(
  gray: Uint8Array,
  width: number,
  height: number,
): bigint {
  if (width <= 0 || height <= 0 || gray.length < width * height) {
    throw new RangeError("Invalid grayscale image dimensions");
  }

  const cols = 9;
  const rows = 8;
  const grid = new Float64Array(cols * rows);

  for (let r = 0; r < rows; r++) {
    const y0 = Math.floor((r * height) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((r + 1) * height) / rows));
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor((c * width) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((c + 1) * width) / cols));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1 && y < height; y++) {
        const rowOffset = y * width;
        for (let x = x0; x < x1 && x < width; x++) {
          sum += gray[rowOffset + x];
          count++;
        }
      }
      grid[r * cols + c] = count > 0 ? sum / count : 0;
    }
  }

  let hash = 0n;
  let bit = 0n;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols - 1; c++) {
      if (grid[r * cols + c] < grid[r * cols + c + 1]) {
        hash |= 1n << bit;
      }
      bit += 1n;
    }
  }
  return hash & MASK_64;
}

/**
 * Compute a 64-bit SimHash over normalized character 3-grams for text-only
 * or OCR snapshots when pixel buffers are absent.
 */
export function computeTextSimHash(text: string): bigint {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return 0n;

  const weights = new Int32Array(64);
  const limit = Math.max(1, normalized.length - 2);
  for (let i = 0; i < limit; i++) {
    const shingle = normalized.slice(i, i + 3);
    const h = fnv1a64(shingle);
    for (let b = 0; b < 64; b++) {
      weights[b] += (h >> BigInt(b)) & 1n ? 1 : -1;
    }
  }

  let out = 0n;
  for (let b = 0; b < 64; b++) {
    if (weights[b] > 0) {
      out |= 1n << BigInt(b);
    }
  }
  return out;
}

function fnv1a64(str: string): bigint {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash = (hash * prime) & MASK_64;
  }
  return hash;
}

export function hammingDistance64(a: bigint, b: bigint): number {
  let x = (a ^ b) & MASK_64;
  let count = 0;
  while (x > 0n) {
    x &= x - 1n;
    count++;
  }
  return count;
}

export function formatHashHex(hash: bigint): string {
  return (hash & MASK_64).toString(16).padStart(16, "0");
}

export function parseHashHex(hex: string): bigint {
  const clean = hex.trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{1,16}$/.test(clean)) {
    throw new SyntaxError(`Invalid 64-bit hex hash: "${hex}"`);
  }
  return BigInt(`0x${clean}`) & MASK_64;
}

export interface DedupeOptions {
  /** Maximum bit difference still considered near-identical (default: 5 of 64). */
  maxHammingDistance?: number;
  /** Time window during which near-duplicate suppression applies (default: 60s). */
  ttlMs?: number;
  now?: () => number;
}

export interface DedupeCheckResult {
  duplicate: boolean;
  hash: bigint;
  distance?: number;
}

export class SnapshotDeduper {
  private lastSeen = new Map<string, { hash: bigint; at: number }>();
  private maxDistance: number;
  private ttlMs: number;
  private now: () => number;

  constructor(options: DedupeOptions = {}) {
    this.maxDistance = options.maxHammingDistance ?? 5;
    this.ttlMs = options.ttlMs ?? 60_000;
    this.now = options.now ?? Date.now;
  }

  /**
   * Record and check a 64-bit snapshot hash under `scope` (typically appName).
   * If a recent snapshot within `ttlMs` is within `maxHammingDistance`, marks
   * `duplicate: true` without refreshing the baseline unnecessarily.
   */
  checkAndRecord(scope: string, hash: bigint): DedupeCheckResult {
    const normalized = hash & MASK_64;
    const timestamp = this.now();
    const prev = this.lastSeen.get(scope);

    if (prev && timestamp - prev.at <= this.ttlMs) {
      const distance = hammingDistance64(prev.hash, normalized);
      if (distance <= this.maxDistance) {
        return { duplicate: true, hash: normalized, distance };
      }
      this.lastSeen.set(scope, { hash: normalized, at: timestamp });
      return { duplicate: false, hash: normalized, distance };
    }

    this.lastSeen.set(scope, { hash: normalized, at: timestamp });
    return { duplicate: false, hash: normalized };
  }

  clear(scope?: string): void {
    if (scope) {
      this.lastSeen.delete(scope);
    } else {
      this.lastSeen.clear();
    }
  }
}
