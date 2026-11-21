// Bubble renderer — receives one artifact offer at a time over IPC and
// renders exactly three actions. No chat box, no history, no free text:
// the product is the artifact, not a conversation.
interface OfferPayload {
  text: string;
  rationale: string;
  degradationNote?: string;
  classicMode?: boolean;
}

interface NoticePayload {
  kind: "silenced" | "degraded" | "classic";
  message: string;
}

interface Window {
  clippie: {
    onOffer(cb: (o: OfferPayload) => void): void;
    onNotice?(cb: (n: NoticePayload) => void): void;
    respond(choice: "insert" | "another" | "dismiss"): void;
    setClassicMode?(enabled: boolean): void;
  };
}

const root = document.getElementById("bubble")!;
const classicBannerEl = document.getElementById("classic-banner")!;
const rationaleEl = document.getElementById("rationale")!;
const artifactEl = document.getElementById("artifact")!;
const degradationEl = document.getElementById("degradation")!;
const noticeEl = document.getElementById("notice")!;
const classicToggle = document.getElementById("classic") as HTMLInputElement;

window.clippie.onOffer((offer) => {
  classicBannerEl.hidden = !offer.classicMode;
  rationaleEl.hidden = !offer.rationale;
  rationaleEl.textContent = offer.rationale ?? "";
  artifactEl.textContent = offer.text;
  degradationEl.hidden = !offer.degradationNote;
  degradationEl.textContent = offer.degradationNote ?? "";
  noticeEl.hidden = true;
  noticeEl.textContent = "";
  root.hidden = false;
});

window.clippie.onNotice?.((notice) => {
  noticeEl.hidden = false;
  noticeEl.textContent = notice.message;
  root.hidden = false;
});

classicToggle.addEventListener("change", () => {
  classicBannerEl.hidden = !classicToggle.checked;
  window.clippie.setClassicMode?.(classicToggle.checked);
});

for (const id of ["insert", "another", "dismiss"] as const) {
  document.getElementById(id)!.addEventListener("click", () => {
    window.clippie.respond(id);
    if (id !== "another") {
      root.hidden = true;
    }
  });
}
