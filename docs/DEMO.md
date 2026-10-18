# TRAILS hackathon demo script (indoor-safe, about 4 minutes)

Before you start: double-click `start-trails.cmd` (Windows) or run `npm run build && npm run story`, so
stories are written live by Gemma on AMD. The public site works too, with pre-generated stories for the
presets. Open it on a laptop and, for the camera part, on a phone over HTTPS.

0. **First-run intro (15 s).** On a fresh browser, TRAILS opens with three short steps. Pick a few
   interests, then **No, show me a demo**: demo mode simulates standing in Piazza Navona. Seen it
   already? Profile → **Show the welcome intro again**.

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
2c. **The story (30 s).** Tap **Tell me the story of this walk**. Point at the badge ("Written by
   Gemma-4-31B-IT · Gemma 4 31B on AMD Developer Cloud Token Factory"), the numbered citations, and
   **Listen**.
2d. **Keep and share it (15 s).** Tap **Save walk** (it appears under Profile → My walks) and **Share**
   (a link that opens the same walk for a friend, with nothing from your profile).
3. **Why these stops (30 s).** Open "How this route was chosen" and point at: neural-network scores,
   the optimiser, the router and the budget check. Note the honesty labels (estimate vs. real route).
4. **It learns (40 s).** On a stop tap **More like this** (the note shows which tastes went up) or
   **Not for me** (TRAILS re-plans without it straight away). Go to **Profile**: the affinity bars moved and the ranked list shows ▲ changes. Back on
   the route, **Re-plan with my latest preferences**.
5. **Walk it (40 s).** Tell the story first (2c), then **Start walking**: a full-screen map. Press play
   on the simulated walk (5×, 10× or 20×). As you near each stop its part of the story appears and is
   read aloud, and places you pass get a short note.
   - The round buttons at the top are sound, GPS / simulated location and route info.
   - Drag the bottom sheet down to see the map, up for details.
   - Rate one place with thumbs up, then **Mark visited** at the stop.
6. **Camera (60 s).** Open **Camera** → **Demo photos**. Pick a held-out photo (e.g. Trevi Fountain):
   the frame and label appear on the best-matching region; tap the label → short history → **Learn
   more** → full page with sources. Pick one of the last photos (another city's landmark): TRAILS says
   it does not recognise it. Optional: switch to **Live camera** on the phone and point it at a photo on
   the laptop screen. Tick "Show recognition details" to show the similarity scores and threshold.
7. **AMD (20 s).** The story badge (2c) is the AMD part: every story is written by Gemma 4 31B on the
   AMD Developer Cloud Token Factory.
   - Numbers: `docs/story_eval_Gemma-4-31B-IT.json` (5/5 walks, 17/17 stops, 0 unsupported numbers).
   - Be precise about the rest: the taste model was trained on CPU. `amd/train_rocm.sh` and
     `amd/serve_llm.sh` (ROCm / Instinct) are ready but have not been run.

## Things to say carefully

* Recommendation metrics come from **synthetic** users; they show the network learns the simulated
  preference structure, not real-world quality.
* Camera recognition supports **27 Rome landmarks** (now including the Colosseum and Pantheon) and was
  measured on web photos, not street video.
* The overlay is a 2D label on the best-matching image region, not 3D AR tracking.
* Routes are labelled by source; a dashed amber line is an estimate, not a walking route.
