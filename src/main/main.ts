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
import { app, BrowserWindow, Tray, ipcMain } from "electron";
import * as path from "node:path";

let bubble: BrowserWindow | null = null;

function createBubble(): BrowserWindow {
  const win = new BrowserWindow({
    width: 340,
    height: 220,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  void win.loadFile(path.join(__dirname, "../renderer/bubble.html"));
  return win;
}

app.whenReady().then(() => {
  bubble = createBubble();
  // Tray icon + menu (mute for 30 min / classic mode / quit) land with the
  // Milestone 1 bubble wiring.
  void Tray;
  ipcMain.on("clippie:dismiss", () => bubble?.hide());
});

app.on("window-all-closed", () => {
  // A desktop companion lives in the tray; closing windows never quits.
});
