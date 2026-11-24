import { contextBridge, ipcRenderer } from "electron";

export interface ClippieOfferPayload {
  text: string;
  rationale: string;
  stuckType?: string;
  degradationNote?: string;
  classicMode?: boolean;
}

export interface ClippieNoticePayload {
  kind: "silenced" | "degraded" | "classic";
  message: string;
}

contextBridge.exposeInMainWorld("clippie", {
  onOffer(cb: (offer: ClippieOfferPayload) => void): void {
    ipcRenderer.on("clippie:offer", (_event, offer: ClippieOfferPayload) => {
      cb(offer);
    });
  },
  onNotice(cb: (notice: ClippieNoticePayload) => void): void {
    ipcRenderer.on("clippie:notice", (_event, notice: ClippieNoticePayload) => {
      cb(notice);
    });
  },
  respond(choice: "insert" | "another" | "dismiss"): void {
    ipcRenderer.send("clippie:respond", choice);
  },
  setClassicMode(enabled: boolean): void {
    ipcRenderer.send("clippie:classic-mode", enabled);
  },
});
