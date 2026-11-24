#!/usr/bin/env node
/**
 * Synthesizes per-scene voiceover narration using macOS `say` + `ffmpeg`,
 * measures exact millisecond durations via `ffprobe`, concatenates a master
 * audio track (`out/audio/voiceover.m4a`), and emits `out/audio/timings.json`
 * + `out/clippie-kiroween-demo.srt` so the browser demo choreography stays
 * frame-accurate with the voiceover.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT_DIR = path.join(ROOT, "out");
const AUDIO_DIR = path.join(OUT_DIR, "audio");
fs.mkdirSync(AUDIO_DIR, { recursive: true });

const SCENES = [
  {
    id: "scene1",
    title: "The Problem: 1997 Interruptions vs. 2026 Passive Chatboxes",
    caption: "1997 Clippy interrupted with generic advice · 2026 chatbots force context-switching",
    voiceText:
      "Why did the original Clippy die in nineteen ninety-seven? Because it interrupted at the wrong time, gave generic advice, and never learned. Yet modern AI assistants have the opposite flaw: they are passive chat sidebars that force you to stop writing, copy context out, and prompt-engineer a reply. Clippie resurrects the desktop paperclip as a closed-loop multimodal agent that observes, decides, acts, and learns.",
  },
  {
    id: "scene2",
    title: "Restraint by Default — Zero Polling, Zero Distraction",
    caption: "Restraint first: local event stream only · 0 continuous capture · 0 LLM calls on steady typing",
    voiceText:
      "Restraint is our first feature. During normal writing, Clippie stays completely invisible in the menu bar. There is no chat box, no continuous screen recording, and zero background model polling.",
  },
  {
    id: "scene3",
    title: "Stuck Detection → Regenerate → One-Click Cursor Insertion",
    caption: "3× paragraph rewrites + 4× PDF switches → missing-transition (0.82) → 1-click L2 AX insert",
    voiceText:
      "Watch what happens when we get stuck bridging Related Work to Method—rewriting the same sentence three times while switching to a reference PDF four times. Clippie's local detector fires, captures a single active-window OCR snapshot, and offers one finished two-sentence bridge. We can click Another version for a tighter angle, then click Insert at cursor to splice it straight into the document with snapshot-backed undo.",
  },
  {
    id: "scene4",
    title: "Closing the Loop — Outcome Learning & 30-Minute Silence",
    caption: "Kept draft boosts weight (1.00 → 1.10) · 3 consecutive dismissals trigger 30m silence",
    voiceText:
      "Next, Clippie closes the feedback loop. When we keep the inserted bridge and continue writing past it, the outcome observer boosts the weight for transitions in Word. Conversely, if we dismiss a blank-page suggestion three times in a row, Clippie announces it is going quiet for thirty minutes—and actually shuts up.",
  },
  {
    id: "scene5",
    title: "Honest L2 → L3 Degradation on Read-Only / Elevated Windows",
    caption: "LayeredDocumentAdapter: L2 AX/UIA blocked → L3 paste fallback with clipboard restore",
    voiceText:
      "When a target window blocks accessibility writes—such as an elevated Windows app—our Layered Document Adapter falls back to L3 clipboard paste, restores the user's original clipboard, and states the degradation honestly in the bubble.",
  },
  {
    id: "scene6",
    title: "Opt-In '97 Mode & Kiro Spec-Driven Architecture",
    caption: "Built with .kiro/specs, .kiro/steering & executable .kiro/hooks · 54/54 CI tests passing",
    voiceText:
      "An opt-in ninety-seven toggle brings back classic eager Clippy for a quick laugh. Under the hood, Clippie was built spec-first with Kiro: specs decomposed our L1-to-L3 adapters, steering files banned chat drift and continuous capture, and executable Kiro hooks enforce those invariants across fifty-four cross-platform tests. Dead software—back with a brain, and with manners.",
  },
];

const LEAD_IN_MS = 500;
const INTER_SCENE_GAP_MS = 450;
const TAIL_MS = 1200;

function probeDurationMs(filePath) {
  const out = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ],
    { encoding: "utf8" },
  ).trim();
  return Math.round(parseFloat(out) * 1000);
}

function makeSilenceWav(filePath, durationMs) {
  execFileSync("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=44100:cl=mono",
    "-t",
    (durationMs / 1000).toFixed(3),
    "-c:a",
    "pcm_s16le",
    filePath,
  ], { stdio: "ignore" });
}

function formatSrtTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const millis = ms % 1000;
  const hrs = String(Math.floor(totalSec / 3600)).padStart(2, "0");
  const mins = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
  const secs = String(totalSec % 60).padStart(2, "0");
  return `${hrs}:${mins}:${secs},${String(millis).padStart(3, "0")}`;
}

const concatParts = [];
const leadWav = path.join(AUDIO_DIR, "lead.wav");
makeSilenceWav(leadWav, LEAD_IN_MS);
concatParts.push(leadWav);

const gapWav = path.join(AUDIO_DIR, "gap.wav");
makeSilenceWav(gapWav, INTER_SCENE_GAP_MS);

const tailWav = path.join(AUDIO_DIR, "tail.wav");
makeSilenceWav(tailWav, TAIL_MS);

let cursorMs = LEAD_IN_MS;
const sceneTimings = [];
const srtBlocks = [];

SCENES.forEach((scene, idx) => {
  const aiff = path.join(AUDIO_DIR, `${scene.id}.aiff`);
  const wav = path.join(AUDIO_DIR, `${scene.id}.wav`);

  execFileSync("say", ["-v", "Samantha", "-r", "182", "-o", aiff, scene.voiceText]);
  execFileSync(
    "ffmpeg",
    ["-y", "-i", aiff, "-ar", "44100", "-ac", "1", "-c:a", "pcm_s16le", wav],
    { stdio: "ignore" },
  );
  fs.rmSync(aiff, { force: true });

  const voiceMs = probeDurationMs(wav);
  const startMs = cursorMs;
  const totalSceneMs = voiceMs + (idx < SCENES.length - 1 ? INTER_SCENE_GAP_MS : TAIL_MS);
  const endMs = startMs + totalSceneMs;

  sceneTimings.push({
    id: scene.id,
    title: scene.title,
    caption: scene.caption,
    voiceText: scene.voiceText,
    startMs,
    voiceMs,
    durationMs: totalSceneMs,
    endMs,
  });

  srtBlocks.push(
    `${idx + 1}\n${formatSrtTime(startMs)} --> ${formatSrtTime(startMs + voiceMs)}\n${scene.voiceText}\n`,
  );

  concatParts.push(wav);
  concatParts.push(idx < SCENES.length - 1 ? gapWav : tailWav);
  cursorMs = endMs;
});

const concatListPath = path.join(AUDIO_DIR, "concat.txt");
fs.writeFileSync(
  concatListPath,
  concatParts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
);

const masterAudioPath = path.join(AUDIO_DIR, "voiceover.m4a");
execFileSync(
  "ffmpeg",
  [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatListPath,
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    masterAudioPath,
  ],
  { stdio: "ignore" },
);

const totalDurationMs = probeDurationMs(masterAudioPath);
const timingsPayload = {
  leadInMs: LEAD_IN_MS,
  totalDurationMs,
  scenes: sceneTimings,
};

fs.writeFileSync(
  path.join(AUDIO_DIR, "timings.json"),
  JSON.stringify(timingsPayload, null, 2),
);
fs.writeFileSync(
  path.join(OUT_DIR, "clippie-kiroween-demo.srt"),
  srtBlocks.join("\n"),
);

console.log(
  `[voiceover OK] Total ${(totalDurationMs / 1000).toFixed(1)}s (${sceneTimings.length} scenes) -> ${masterAudioPath}`,
);
for (const s of sceneTimings) {
  console.log(
    `  ${s.id}: ${(s.startMs / 1000).toFixed(1)}s -> ${(s.endMs / 1000).toFixed(1)}s (${(s.durationMs / 1000).toFixed(1)}s)`,
  );
}
