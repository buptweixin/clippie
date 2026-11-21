/**
 * Electron main process — deliberately dumb.
 *
 * The main process owns only: the tray icon, the bubble window, and IPC to
 * the perception daemon and native sidecars. It never touches accessibility
 * APIs or screen capture directly (see src/main/permissions.ts for why the
 * signed native sidecar owns those grants on macOS).
 *
 * Scaffold status: window/tray wiring is real; daemon and sidecar IPC
 * endpoints are the Milestone 2/3 tasks in .kiro/specs/clippie/tasks.md.
 */
import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "node:path";

let bubble: BrowserWindow | null = null;
let classicMode = false;

type OfferChoice = "insert" | "another" | "dismiss";
let pendingChoiceResolve: ((choice: OfferChoice) => void) | null = null;

function createBubble(): BrowserWindow {
  const win = new BrowserWindow({
    width: 360,
    height: 260,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  void win.loadFile(path.join(__dirname, "../renderer/bubble.html"));
  return win;
}

export function showOffer(payload: {
  text: string;
  rationale: string;
  degradationNote?: string;
}): Promise<OfferChoice> {
  if (!bubble) {
    return Promise.resolve("dismiss");
  }
  bubble.webContents.send("clippie:offer", { ...payload, classicMode });
  bubble.showInactive();
  return new Promise((resolve) => {
    pendingChoiceResolve = resolve;
  });
}

export function sendNotice(notice: {
  kind: "silenced" | "degraded" | "classic";
  message: string;
}): void {
  if (!bubble) return;
  bubble.webContents.send("clippie:notice", notice);
  bubble.showInactive();
}

app.whenReady().then(() => {
  bubble = createBubble();

  ipcMain.on("clippie:respond", (_event, choice: OfferChoice) => {
    if (choice !== "another") {
      bubble?.hide();
    }
    const resolve = pendingChoiceResolve;
    pendingChoiceResolve = null;
    resolve?.(choice);
  });

  ipcMain.on("clippie:classic-mode", (_event, enabled: boolean) => {
    classicMode = Boolean(enabled);
    if (classicMode) {
      sendNotice({
        kind: "classic",
        message: "It looks like you're trying to write a document!",
      });
    }
  });

  ipcMain.on("clippie:dismiss", () => {
    bubble?.hide();
    const resolve = pendingChoiceResolve;
    pendingChoiceResolve = null;
    resolve?.("dismiss");
  });
});

app.on("window-all-closed", () => {
  // A desktop companion lives in the tray; closing windows never quits.
});
