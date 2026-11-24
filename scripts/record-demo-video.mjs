#!/usr/bin/env node
/**
 * Records the 1920x1080 Full HD 30fps Clippie demo video via Headless Chrome
 * DevTools Protocol (CDP) + FFmpeg, synchronized to `out/audio/voiceover.m4a`.
 */

import { execFileSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT_DIR = path.join(ROOT, "out");
const AUDIO_PATH = path.join(OUT_DIR, "audio/voiceover.m4a");
const TIMINGS_PATH = path.join(OUT_DIR, "audio/timings.json");
const OUTPUT_MP4 = path.join(OUT_DIR, "clippie-kiroween-demo.mp4");

const CHROME_BIN =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CDP_PORT = 9347;
const STAGE_URL = "http://127.0.0.1:4173/";
const FPS = 30;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function waitForCdpPage(port) {
  for (let i = 0; i < 40; i++) {
    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      const page = targets.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome still booting
    }
    await sleep(150);
  }
  throw new Error("Timed out waiting for Chrome CDP endpoint");
}

class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();

    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id) {
        const entry = this.pending.get(msg.id);
        if (!entry) return;
        this.pending.delete(msg.id);
        if (msg.error) {
          entry.reject(new Error(msg.error.message));
        } else {
          entry.resolve(msg.result ?? {});
        }
      } else if (msg.method) {
        const handlers = this.listeners.get(msg.method) ?? [];
        for (const fn of handlers) fn(msg.params ?? {});
      }
    });
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    return new CdpClient(ws);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, cb) {
    const list = this.listeners.get(method) ?? [];
    list.push(cb);
    this.listeners.set(method, list);
  }

  close() {
    this.ws.close();
  }
}

async function main() {
  const timings = JSON.parse(fs.readFileSync(TIMINGS_PATH, "utf8"));
  const totalDurationMs = timings.totalDurationMs + 500;
  const totalFrames = Math.ceil((totalDurationMs / 1000) * FPS);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "clippie-cdp-"));
  const chrome = spawn(
    CHROME_BIN,
    [
      "--headless=new",
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${userDataDir}`,
      "--window-size=1280,720",
      "--force-device-scale-factor=1.5",
      "--hide-scrollbars",
      "--mute-audio",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  try {
    const wsUrl = await waitForCdpPage(CDP_PORT);
    const cdp = await CdpClient.connect(wsUrl);

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 720,
      deviceScaleFactor: 1.5,
      mobile: false,
    });

    const loaded = new Promise((resolve) => cdp.on("Page.loadEventFired", resolve));
    await cdp.send("Page.navigate", { url: STAGE_URL });
    await loaded;
    await sleep(500);

    // Seed initial 1920x1080 JPEG frame before starting FFmpeg pipe
    const firstSnap = await cdp.send("Page.captureScreenshot", {
      format: "jpeg",
      quality: 92,
    });
    let latestFrame = Buffer.from(firstSnap.data, "base64");

    cdp.on("Page.screencastFrame", (params) => {
      latestFrame = Buffer.from(params.data, "base64");
      void cdp.send("Page.screencastFrameAck", { sessionId: params.sessionId });
    });

    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 92,
      maxWidth: 1920,
      maxHeight: 1080,
      everyNthFrame: 1,
    });

    const ffmpeg = spawn(
      "ffmpeg",
      [
        "-y",
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "-framerate",
        String(FPS),
        "-i",
        "-",
        "-i",
        AUDIO_PATH,
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "19",
        "-pix_fmt",
        "yuv420p",
        "-r",
        String(FPS),
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        "-shortest",
        OUTPUT_MP4,
      ],
      { stdio: ["pipe", "ignore", "pipe"] },
    );

    let ffmpegErr = "";
    ffmpeg.stderr.on("data", (c) => {
      ffmpegErr += String(c);
    });

    console.log(
      `[recorder] Recording ${totalFrames} frames (${(totalDurationMs / 1000).toFixed(1)}s @ ${FPS}fps, 1920x1080)...`,
    );

    const t0 = performance.now();
    await cdp.send("Runtime.evaluate", {
      expression: "void window.startClippieDemo()",
    });

    for (let f = 0; f < totalFrames; f++) {
      const ok = ffmpeg.stdin.write(latestFrame);
      if (!ok) {
        await new Promise((r) => ffmpeg.stdin.once("drain", r));
      }

      if (f > 0 && f % (FPS * 15) === 0) {
        console.log(
          `[recorder] Progress: ${Math.round(f / FPS)}s / ${Math.round(totalDurationMs / 1000)}s`,
        );
      }

      const nextTickMs = ((f + 1) * 1000) / FPS;
      const waitMs = nextTickMs - (performance.now() - t0);
      if (waitMs > 1) {
        await sleep(waitMs);
      }
    }

    ffmpeg.stdin.end();
    const exitCode = await new Promise((resolve) => ffmpeg.on("close", resolve));
    if (exitCode !== 0) {
      throw new Error(`FFmpeg exited with ${exitCode}: ${ffmpegErr.slice(-500)}`);
    }

    await cdp.send("Page.stopScreencast");
    cdp.close();

    // Extract 4 keyframes for visual quality assurance
    const keyframes = [
      { at: "8", name: "verify_s1_problem.png" },
      { at: "46", name: "verify_s3_bubble.png" },
      { at: "84", name: "verify_s5_degradation.png" },
      { at: "105", name: "verify_s6_kiro.png" },
    ];
    for (const kf of keyframes) {
      execFileSync(
        "ffmpeg",
        [
          "-y",
          "-ss",
          kf.at,
          "-i",
          OUTPUT_MP4,
          "-frames:v",
          "1",
          path.join(OUT_DIR, kf.name),
        ],
        { stdio: "ignore" },
      );
    }

    const stat = fs.statSync(OUTPUT_MP4);
    console.log(
      `[recorder OK] Saved ${OUTPUT_MP4} (${(stat.size / (1024 * 1024)).toFixed(2)} MiB)`,
    );
  } finally {
    chrome.kill("SIGKILL");
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

void main();
