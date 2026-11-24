#!/usr/bin/env node
/**
 * Kiro spec & steering invariant checker (invoked by .kiro/hooks/spec-check.kiro.hook
 * and GitHub Actions CI).
 *
 * Verifies:
 *   1. Every repo file path referenced in checked `[x]` items of
 *      `.kiro/specs/clippie/tasks.md` exists on disk.
 *   2. Steering rule (.kiro/steering/product.md — "Three actions max, no chat box"):
 *      `src/renderer/bubble.html` has exactly 3 buttons inside `.actions` and
 *      zero text/chat inputs (`<textarea>` or `<input type="text">`).
 *   3. Steering rule (.kiro/steering/tech.md — "No continuous screen capture, ever"):
 *      `native/` contains no continuous stream recorders (`CGDisplayStream` or
 *      `SCStream(` live stream sessions).
 */

import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const errors = [];

// 1. Checked tasks in .kiro/specs/clippie/tasks.md must reference real files
const tasksPath = path.join(ROOT, ".kiro/specs/clippie/tasks.md");
const tasksMd = fs.readFileSync(tasksPath, "utf8");
for (const line of tasksMd.split(/\r?\n/)) {
  if (!/^\s*-\s*\[x\]/i.test(line)) continue;
  const refs = [...line.matchAll(/`([^`]+\.[a-z0-9]+)`/gi)].map((m) => m[1]);
  for (const rel of refs) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) {
      errors.push(`Checked task references missing file "${rel}": ${line.trim()}`);
    }
  }
}

// 2. Product steering rule: <= 3 action buttons, zero chat/text inputs in bubble.html
const bubbleHtml = fs.readFileSync(
  path.join(ROOT, "src/renderer/bubble.html"),
  "utf8",
);
const actionsBlockMatch = bubbleHtml.match(
  /<div[^>]*class="[^"]*\bactions\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
);
if (!actionsBlockMatch) {
  errors.push("src/renderer/bubble.html is missing the `.actions` container.");
} else {
  const buttonMatches = [...actionsBlockMatch[1].matchAll(/<button\b/gi)];
  if (buttonMatches.length !== 3) {
    errors.push(
      `Product steering violation: expected exactly 3 action buttons in bubble.html, found ${buttonMatches.length}.`,
    );
  }
}

if (/<textarea\b/i.test(bubbleHtml) || /<input[^>]+type=["']text["']/i.test(bubbleHtml)) {
  errors.push(
    "Product steering violation: free-text chat input found in src/renderer/bubble.html.",
  );
}

// 3. Tech steering rule: no continuous screen streaming in native sidecars
for (const rel of ["native/macos/Sidecar.swift", "native/windows/Program.cs"]) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) continue;
  const src = fs.readFileSync(full, "utf8");
  if (/\bCGDisplayStream\b/.test(src) || /\bSCStream\s*\(/.test(src)) {
    errors.push(
      `Tech steering violation: continuous screen stream API detected in ${rel}.`,
    );
  }
}

if (errors.length > 0) {
  for (const err of errors) {
    console.error(`[spec-check FAIL] ${err}`);
  }
  process.exit(1);
}

console.log(
  "[spec-check OK] .kiro/specs/clippie/tasks.md and .kiro/steering/* invariants verified.",
);
