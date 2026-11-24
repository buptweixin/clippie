# Launch post (X / Twitter)

📎 It looks like you're trying to write a document...

I'm resurrecting Clippy for #Kiroween 2026 — same paperclip, but now with
actual multimodal vision.

It sees your screen & doc, detects when you're stuck, generates a real
draft, inserts it at your cursor in one click, and learns from what you
keep or delete. Not a chatbot in the corner — an agent loop that acts.

Building it with Devin on the hard parts: accessibility APIs, OS-level
insertion, and macOS/Windows permissions.

Open source repo + 2-min live demo 👇
Repo: https://github.com/buptweixin/clippie
Demo: https://youtu.be/ctkqzHMfO-E

---

Thread:

2/ Original Clippy died because it only talked. This one closes the loop:

observe (idle, rewrites, app-switching) → generate a finished artifact →
execute (insert/replace/annotate in your doc) → watch the outcome
(kept = +, deleted = -)

That's the whole product.

3/ Hardest part isn't the model — it's the last mile: AXUIElement on
macOS, UI Automation on Windows, clipboard fallback when nothing else
works.

Building in public until the Dec 4 deadline. Demo soon.
