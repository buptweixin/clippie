// Bubble renderer — receives one artifact offer at a time over IPC and
// renders exactly three actions. No chat box, no history, no free text:
// the product is the artifact, not a conversation.
interface OfferPayload {
  text: string;
  rationale: string;
  stuckType?: string;
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

const STUCK_LABELS: Record<string, string> = {
  "blank-page": "Starter outline",
  "missing-transition": "Section bridge",
  "missing-citation": "Citation anchor",
  "needs-summary": "Passage summary",
  "no-outline": "Structure draft",
};

const root = document.getElementById("bubble")!;
const stuckBadgeEl = document.getElementById("stuck-badge")!;
const classicBannerEl = document.getElementById("classic-banner")!;
const rationaleEl = document.getElementById("rationale")!;
const artifactEl = document.getElementById("artifact")!;
const degradationEl = document.getElementById("degradation")!;
const noticeEl = document.getElementById("notice")!;
const classicToggle = document.getElementById("classic") as HTMLInputElement;
const insertBtn = document.getElementById("insert") as HTMLButtonElement;
const anotherBtn = document.getElementById("another") as HTMLButtonElement;
const dismissBtn = document.getElementById("dismiss") as HTMLButtonElement;

function setPendingRegeneration(pending: boolean): void {
  insertBtn.disabled = pending;
  anotherBtn.disabled = pending;
  anotherBtn.textContent = pending ? "Drafting…" : "Another version";
}

function submitChoice(choice: "insert" | "another" | "dismiss"): void {
  if (choice === "another") {
    setPendingRegeneration(true);
    window.clippie.respond("another");
    return;
  }
  window.clippie.respond(choice);
  root.hidden = true;
}

window.clippie.onOffer((offer) => {
  setPendingRegeneration(false);
  classicToggle.checked = Boolean(offer.classicMode);
  classicBannerEl.hidden = !offer.classicMode;
  stuckBadgeEl.textContent =
    (offer.stuckType && STUCK_LABELS[offer.stuckType]) || "Ready draft";
  rationaleEl.hidden = !offer.rationale;
  rationaleEl.textContent = offer.rationale ?? "";
  artifactEl.hidden = false;
  artifactEl.textContent = offer.text;
  degradationEl.hidden = !offer.degradationNote;
  degradationEl.textContent = offer.degradationNote ?? "";
  noticeEl.hidden = true;
  noticeEl.textContent = "";
  root.hidden = false;
});

window.clippie.onNotice?.((notice) => {
  setPendingRegeneration(false);
  noticeEl.hidden = false;
  noticeEl.textContent = notice.message;
  root.hidden = false;
});

classicToggle.addEventListener("change", () => {
  classicBannerEl.hidden = !classicToggle.checked;
  window.clippie.setClassicMode?.(classicToggle.checked);
});

insertBtn.addEventListener("click", () => submitChoice("insert"));
anotherBtn.addEventListener("click", () => submitChoice("another"));
dismissBtn.addEventListener("click", () => submitChoice("dismiss"));

window.addEventListener("keydown", (e) => {
  if (root.hidden) return;
  if (e.key === "Escape") {
    e.preventDefault();
    submitChoice("dismiss");
  } else if (e.key === "Enter" && !insertBtn.disabled) {
    e.preventDefault();
    submitChoice("insert");
  }
});
