# TRAILS hackathon demo script (indoor-safe, about 4 minutes)

Before you start: `npm run build && npm run preview` (or the deployed HTTPS URL). Open it on a laptop
and, for the camera part, on a phone over HTTPS. Turn on **Demo** in the header so location is
simulated; choose the scenario "Standing in Piazza Navona".

1. **Pitch (20 s).** "Navigation apps optimise A to B. TRAILS adds a cultural layer that learns what
   you love. Every route has a story."
2. **Same walk, two people (60 s).** On Plan, tap the preset **Ancient stones** (Pantheon → Colosseum,
   45 min, Ancient + Archaeology + Hidden gems). Show the stops, the time-budget bar (walking vs.
   exploring) and the badges: which router produced the line, and "Stops ranked by the preference
   network". Go back and tap **Renaissance & Baroque**: same start, end and time, different stops.
2b. **Any A to any B (30 s).** Type a real address in From (or tap **Pick on the map**) and a
   restaurant or hotel in To. TRAILS bends an ordinary walk past what you love: stops to visit, places
   it walks you past, and "Also on your path".
2a. **The trade-off (15 s).** Point at the card at the top of the route: the fastest walk (dotted grey on
   the map) against your TRAILS walk: "+N minutes buys you these places, this many strong matches for you".
2c. **The story (30 s).** Tap **Tell me the story of this walk**. Point at the badge (model and AMD
   hardware that wrote it), the numbered citations, and **Listen**.
3. **Why these stops (30 s).** Open "How this route was chosen" and point at: neural-network scores,
   the optimiser, the router and the budget check. Note the honesty labels (estimate vs. real route).
4. **It learns (40 s).** On a stop tap **More like this** (the note shows which tastes went up) or
   **Not for me** (TRAILS re-plans without it straight away). Go to **Profile**: the affinity bars moved and the ranked list shows ▲ changes. Back on
   the route, **Re-plan with my latest preferences**.
5. **Walk it (40 s).** Tell the story first (2c), then **Start walking** → press play on the simulated
   walk at 20×. As you near each stop its part of the story appears and is read aloud (**Audio guide
   on**), and places you pass get a short note. Rate one with thumbs up, then **Mark visited** at the stop.
6. **Camera (60 s).** Open **Camera** → **Demo photos**. Pick a held-out photo (e.g. Trevi Fountain):
   the frame and label appear on the best-matching region; tap the label → short history → **Learn
   more** → full page with sources. Pick one of the last photos (another city's landmark): TRAILS says
   it does not recognise it. Optional: switch to **Live camera** on the phone and point it at a photo on
   the laptop screen. Tick "Show recognition details" to show the similarity scores and threshold.
7. **AMD (20 s).** Show `docs/AMD_ROCM.md` and `ml/train.py` printing the device. Be precise: the
   model was trained on CPU in the build environment; the same script runs on ROCm GPUs, and GPU
   numbers are only quoted once `ml/benchmark.py` has produced them on AMD Developer Cloud.

## Things to say carefully

* Recommendation metrics come from **synthetic** users; they show the network learns the simulated
  preference structure, not real-world quality.
* Camera recognition supports **27 Rome landmarks** (now including the Colosseum and Pantheon) and was
  measured on web photos, not street video.
* The overlay is a 2D label on the best-matching image region, not 3D AR tracking.
* Routes are labelled by source; a dashed amber line is an estimate, not a walking route.
