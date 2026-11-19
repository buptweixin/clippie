// Bubble renderer — receives one artifact offer at a time over IPC and
// renders exactly three actions. No chat box, no history, no free text:
// the product is the artifact, not a conversation.
interface OfferPayload {
  text: string;
  rationale: string;
  degradationNote?: string;
}

declare global {
  interface Window {
    clippie: {
      onOffer(cb: (o: OfferPayload) => void): void;
      respond(choice: "insert" | "another" | "dismiss"): void;
    };
  }
}

const root = document.getElementById("bubble")!;
const artifactEl = document.getElementById("artifact")!;
const degradationEl = document.getElementById("degradation")!;

window.clippie.onOffer((offer) => {
  artifactEl.textContent = offer.text;
  degradationEl.hidden = !offer.degradationNote;
  degradationEl.textContent = offer.degradationNote ?? "";
  root.hidden = false;
});

for (const id of ["insert", "another", "dismiss"] as const) {
  document.getElementById(id)!.addEventListener("click", () => {
    window.clippie.respond(id);
    root.hidden = true;
  });
}
