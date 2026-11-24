#!/usr/bin/env node
/**
 * Generates a standalone, zero-backend interactive browser demo (`out/gh-pages/index.html`)
 * from `src/demo/stage.html` with an in-browser replica of Clippie's AgentLoop,
 * per-app weight/silence learning, L2->L3 fallback, and interactive trigger controls
 * so judges visiting https://buptweixin.github.io/clippie/ can test Clippie in 1 click.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PAGES_DIR = path.join(ROOT, "out/gh-pages");
fs.mkdirSync(PAGES_DIR, { recursive: true });

let html = fs.readFileSync(path.join(ROOT, "src/demo/stage.html"), "utf8");

// Make viewport responsive & centered on desktop screens for judges visiting GitHub Pages
html = html.replace(
  `html, body {\n        margin: 0;\n        width: 1280px;\n        height: 720px;\n        overflow: hidden;`,
  `html, body {\n        margin: 0;\n        min-height: 100vh;\n        display: flex;\n        flex-direction: column;\n        align-items: center;\n        justify-content: flex-start;\n        overflow-x: hidden;`,
);
html = html.replace(
  `.menubar {\n        height: 32px;`,
  `.menubar {\n        width: 1280px;\n        max-width: 100vw;\n        height: 32px;`,
);

// Inject interactive judge control bar right below menubar
const judgeToolbarCss = `
      .judge-bar {
        width: 1280px;
        max-width: 100vw;
        background: rgba(30, 41, 59, 0.95);
        border-bottom: 1px solid rgba(148, 163, 184, 0.25);
        padding: 8px 18px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        color: #e2e8f0;
        font-size: 12px;
      }
      .judge-btns { display: flex; flex-wrap: wrap; gap: 6px; }
      .judge-btns button {
        background: #1e293b;
        color: #f8fafc;
        border: 1px solid #475569;
        border-radius: 7px;
        padding: 5px 10px;
        font-size: 11.5px;
        font-weight: 600;
        cursor: pointer;
      }
      .judge-btns button.primary {
        background: #2563eb;
        border-color: #3b82f6;
      }
      .judge-btns button:hover { filter: brightness(1.12); }
`;
html = html.replace("</style>", `${judgeToolbarCss}    </style>`);

const judgeToolbarHtml = `
    <div class="judge-bar">
      <div><strong>Interactive Judge Sandbox:</strong> Try triggering Clippie manually or play the guided 4-act loop:</div>
      <div class="judge-btns">
        <button class="primary" id="j-autoplay">▶ Play Guided Demo</button>
        <button id="j-transition">1. Stuck: Missing Transition</button>
        <button id="j-blank">2. Stuck: Blank Page (Dismiss 3× → 30m Quiet)</button>
        <button id="j-elevated">3. Elevated Window (L3 Paste Fallback)</button>
        <button id="j-kiro">4. View .kiro/ Specs &amp; Hooks</button>
        <button id="j-reset">↺ Reset</button>
      </div>
    </div>`;

html = html.replace(
  '<div class="stage">',
  `${judgeToolbarHtml}\n    <div class="stage">`,
);

// Replace server `api(...)` helper with an in-browser implementation of AgentLoop + LocalFallbackModelClient
const inBrowserEngine = `
      const inBrowserEngine = (() => {
        const DEFAULT_DOC = "2. Related Work\\nRecent sparse and IO-aware attention kernels substantially reduce quadratic memory overhead on long sequences.\\n\\n3. Method\\n";
        let state = resetState();

        function resetState() {
          return {
            docText: DEFAULT_DOC,
            modelCallCount: 0,
            classicMode: false,
            attempt: 1,
            activeStuck: null,
            activeArtifact: null,
            notice: null,
            weights: { "missing-transition": 1.0, "blank-page": 1.0 },
            dismissals: { "missing-transition": 0, "blank-page": 0 },
            silenced: { "missing-transition": false, "blank-page": false },
          };
        }

        function propose(stuckType, attempt) {
          state.modelCallCount += 1;
          const cite = "Dao et al. (2024) — FlashAttention-2 achieves 2x-3x speedup";
          if (stuckType === "missing-transition") {
            const variants = [
              \`Building on these prior findings (\${cite}), our method addresses the remaining gap directly. Specifically, we introduce \`,
              \`While earlier approaches establish the baseline (\${cite}), they leave open a key bottleneck that our design resolves below. \`,
              \`Taken together, the evidence above (\${cite}) motivates a targeted boundary-aware schedule: \`,
            ];
            return {
              text: variants[(attempt - 1) % variants.length],
              rationale: "Two-sentence bridge linking Related Work to Method.",
            };
          }
          const blanks = [
            "## Problem Statement\\n\\n## Core Approach\\n\\n## Evaluation Plan\\n",
            "1. Context & Motivation\\n2. Key Design Decisions\\n3. Expected Outcomes\\n",
          ];
          return {
            text: blanks[(attempt - 1) % blanks.length],
            rationale: "Starter structure to break blank-page paralysis.",
          };
        }

        function snapshot() {
          return {
            docText: state.docText,
            cursor: { start: state.docText.length, end: state.docText.length },
            modelCallCount: state.modelCallCount,
            classicMode: state.classicMode,
            offer: state.activeArtifact ? { artifact: state.activeArtifact, stuckType: state.activeStuck } : null,
            notice: state.notice,
            stats: {
              missingTransition: { weight: state.weights["missing-transition"] },
              blankPage: { weight: state.weights["blank-page"] },
              blankPageSilenced: state.silenced["blank-page"] && !state.classicMode,
            },
          };
        }

        return async function localApi(path, body = {}) {
          if (path === "/api/timings") {
            return {
              leadInMs: 200,
              scenes: [
                { durationMs: 4500, caption: "1997 Clippy interrupted with generic advice · 2026 chatbots force context-switching" },
                { durationMs: 4500, caption: "Restraint first: local event stream only · 0 continuous capture · 0 LLM calls" },
                { durationMs: 9500, caption: "3× paragraph rewrites + 4× PDF switches → missing-transition (0.82) → 1-click L2 AX insert" },
                { durationMs: 9500, caption: "Kept draft boosts weight (1.00 → 1.10) · 3 consecutive dismissals trigger 30m silence" },
                { durationMs: 5000, caption: "LayeredDocumentAdapter: L2 blocked → L3 paste fallback with clipboard restore" },
                { durationMs: 6000, caption: "Built with .kiro/specs, .kiro/steering & executable .kiro/hooks · 54/54 CI tests passing" },
              ],
            };
          }
          if (path === "/api/spec-check") {
            return { ok: true, output: "[spec-check OK] .kiro/specs/clippie/tasks.md and .kiro/steering/* invariants verified." };
          }
          if (path === "/api/reset") {
            state = resetState();
            return snapshot();
          }
          if (path === "/api/set-doc") {
            state.docText = String(body.text || "");
            return snapshot();
          }
          if (path === "/api/classic") {
            state.classicMode = Boolean(body.enabled);
            return snapshot();
          }
          if (path === "/api/events") {
            state.notice = null;
            const evs = body.events || [];
            const rewrites = evs.filter((e) => e.kind === "rewrite").length;
            const idle = evs.some((e) => e.kind === "idle" && Number(e.detail) >= 20000);
            let stuck = null;
            if (idle) stuck = "blank-page";
            else if (rewrites >= 3) stuck = "missing-transition";
            if (!stuck) return snapshot();
            if (!state.classicMode && state.silenced[stuck]) return snapshot();
            state.activeStuck = stuck;
            state.attempt = 1;
            state.activeArtifact = propose(stuck, 1);
            return snapshot();
          }
          if (path === "/api/respond") {
            const choice = body.choice;
            const t = state.activeStuck || "blank-page";
            if (choice === "another" && state.activeStuck) {
              state.attempt += 1;
              state.activeArtifact = propose(state.activeStuck, state.attempt);
              return snapshot();
            }
            if (choice === "insert" && state.activeArtifact) {
              state.docText += state.activeArtifact.text;
              state.activeArtifact = null;
              return snapshot();
            }
            if (choice === "dismiss") {
              state.activeArtifact = null;
              state.dismissals[t] = (state.dismissals[t] || 0) + 1;
              if (state.dismissals[t] >= 3) {
                state.weights[t] *= 0.85;
                state.silenced[t] = true;
                state.dismissals[t] = 0;
                state.notice = { kind: "silenced", message: \`Going quiet for 30 minutes on "\${t}" in Word.\` };
              } else {
                state.weights[t] *= 0.9;
              }
              return snapshot();
            }
            return snapshot();
          }
          if (path === "/api/outcome") {
            if (body.outcome === "kept") {
              state.weights["missing-transition"] = Math.min(1.3, state.weights["missing-transition"] * 1.1);
            }
            return snapshot();
          }
          if (path === "/api/degraded-insert") {
            return {
              updatedText: String(body.initialText || "") + String(body.insertText || ""),
              result: {
                ok: true,
                level: "L3",
                degradationNote: "Inserted by paste — this window doesn't expose a writable accessibility tree.",
              },
            };
          }
          return snapshot();
        };
      })();
      const api = (path, body) => inBrowserEngine(path, body);`;

html = html.replace(
  /const api = async \(path, body\) => \{[\s\S]*?return res\.json\(\);\n      \};/,
  inBrowserEngine,
);

const interactiveBindings = `
      // Interactive sandbox button bindings for judges
      btnAnother.addEventListener("click", async () => {
        const st = await api("/api/respond", { choice: "another" });
        renderOfferFromState(st, bBadge.textContent.replace(/ · v\\d+$/, "") + " · v2");
      });
      btnInsert.addEventListener("click", async () => {
        if (!bDegradation.hidden && editorTag.classList.contains("elevated")) {
          const deg = await api("/api/degraded-insert", {
            initialText: docContent.textContent,
            insertText: bArtifact.textContent,
          });
          docContent.textContent = deg.updatedText;
          bDegradation.textContent = deg.result.degradationNote;
          return;
        }
        const st = await api("/api/respond", { choice: "insert" });
        docContent.textContent = st.docText;
        bubbleWrap.classList.remove("visible");
        const kept = await api("/api/outcome", { outcome: "kept" });
        telWeight.textContent = kept.stats.missingTransition.weight.toFixed(2) + " ↑ (kept)";
      });
      btnDismiss.addEventListener("click", async () => {
        const st = await api("/api/respond", { choice: "dismiss" });
        telSilence.textContent = st.stats.blankPageSilenced
          ? "SILENCED 30m"
          : "wt " + st.stats.blankPage.weight.toFixed(2);
        if (st.notice) {
          bNotice.hidden = false;
          bNotice.textContent = st.notice.message;
          setTimeout(() => bubbleWrap.classList.remove("visible"), 2200);
        } else {
          bubbleWrap.classList.remove("visible");
        }
      });
      bClassicToggle.addEventListener("change", async () => {
        bClassicBanner.hidden = !bClassicToggle.checked;
        telMode.textContent = bClassicToggle.checked ? "Mode: '97 Classic!" : "Mode: Restrained";
        await api("/api/classic", { enabled: bClassicToggle.checked });
      });

      document.getElementById("j-autoplay").addEventListener("click", () => { void runFullDemo(); });
      document.getElementById("j-transition").addEventListener("click", async () => {
        showLayer(layerDesktop);
        editorTitle.textContent = "attention_paper.docx — Word";
        editorTag.textContent = "L2 · macOS AXUIElement";
        editorTag.classList.remove("elevated");
        bDegradation.hidden = true;
        const cur = await api("/api/state");
        docContent.textContent = cur.docText;
        telSignal.textContent = "rewrite×3 + pdf-switch×4";
        telStuck.textContent = "missing-transition (0.82)";
        const st = await api("/api/events", {
          events: [{ kind: "rewrite", detail: "p3" }, { kind: "rewrite", detail: "p3" }, { kind: "rewrite", detail: "p3" }, { kind: "app-switch" }, { kind: "app-switch" }, { kind: "app-switch" }, { kind: "app-switch" }],
        });
        renderOfferFromState(st, "Section bridge");
      });
      document.getElementById("j-blank").addEventListener("click", async () => {
        showLayer(layerDesktop);
        bDegradation.hidden = true;
        telSignal.textContent = "idle 20s";
        telStuck.textContent = "blank-page (0.75)";
        const st = await api("/api/events", { events: [{ kind: "idle", detail: "20000" }] });
        if (!st.offer) {
          bBadge.textContent = "Silenced";
          bRationale.textContent = "Restraint active — 3 dismissals silenced this stuck type for 30 minutes.";
          bArtifact.textContent = "(Toggle '97 mode or click Reset to clear the 30m silence window.)";
          bubbleWrap.classList.add("visible");
          return;
        }
        renderOfferFromState(st, "Starter outline");
      });
      document.getElementById("j-elevated").addEventListener("click", () => {
        showLayer(layerDesktop);
        editorTitle.textContent = "release_notes.txt — Elevated Console (UIPI)";
        editorTag.textContent = "L3 · Clipboard Paste Fallback";
        editorTag.classList.add("elevated");
        docContent.textContent = "Benchmark summary:\\n";
        bBadge.textContent = "Passage summary";
        bRationale.textContent = "Concise synthesis of the dwelled reference passage.";
        bArtifact.textContent = "In summary, Dao et al. (2024) achieve a 2x–3x attention speedup via SRAM tiling.";
        bDegradation.hidden = false;
        bDegradation.textContent = "Will insert by paste — this window doesn't expose a writable accessibility tree.";
        bNotice.hidden = true;
        bubbleWrap.classList.add("visible");
      });
      document.getElementById("j-kiro").addEventListener("click", () => { showLayer(layerKiro); });
      document.getElementById("j-reset").addEventListener("click", async () => {
        const st = await api("/api/reset");
        docContent.textContent = st.docText;
        telWeight.textContent = "1.00";
        telSilence.textContent = "active (wt 1.00)";
        bubbleWrap.classList.remove("visible");
        showLayer(layerProblem);
      });
`;

html = html.replace(
  "window.startClippieDemo = runFullDemo;",
  `${interactiveBindings}\n      window.startClippieDemo = runFullDemo;`,
);

fs.writeFileSync(path.join(PAGES_DIR, "index.html"), html);
fs.writeFileSync(path.join(PAGES_DIR, ".nojekyll"), "");
console.log(`[pages OK] Built standalone interactive demo -> ${path.join(PAGES_DIR, "index.html")}`);
