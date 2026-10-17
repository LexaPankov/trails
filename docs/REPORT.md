# TRAILS final report

Status labels: **Implemented** (built and tested here), **Partial** (built, some part not verified),
**Mocked/simulated** (stands in for a real input), **Untested** (built but never run in its real setting).

## 1. Features

| Feature | Status |
| --- | --- |
| Plan screen (A): any address or map pin to any address or map pin, time budget, 8 interests, 3 modes, presets | Implemented, browser-tested with TRAILS-place search and map pins; live OpenStreetMap address search (Photon/Nominatim) **untested** because the build sandbox cannot reach it |
| Culture-rich path between arbitrary points: visits plus pass-by places (~2 min look) and "also on your path" (within 40 m) | Implemented, unit- and browser-tested |
| AI storyteller: grounded, cited story of the walk, with read-aloud | Implemented; tested with a stand-in model and the offline fallback; **not yet run with Gemma on AMD** |
| Route results (B): map, ordered stops, budget bar, router and model badges, "how this route was chosen" | Implemented, browser-tested |
| Trade-off card: TRAILS walk vs. fastest walk (extra minutes, places and strong matches on each route; fastest walk drawn dotted) | Implemented, unit- and browser-tested. Counts come from the plan itself; with an estimated (straight-line) route the counts are rough |
| Walk-mode audio guide: story segment or notes for each stop and a short note for each place passed, shown and read aloud within 60 m | Implemented, unit-tested and browser-tested with the simulated walk; **not field-tested** with GPS |
| Thumbs up / down with a visible taste change ("Baroque ↑") and re-plan | Implemented, unit- and browser-tested |
| Place page (C): licensed photo, periods, themes, then & now, history, sources, related places, reactions | Implemented, browser-tested |
| Navigation (D): next instruction, next stop, remaining distance and time, arrival cards, mark visited | Implemented. Simulated walk browser-tested; real GPS **untested in the field** |
| Camera (E): demo photos, live camera, upload, unknown state, 2D label overlay, recognition details | Implemented. Demo photos browser-tested; live camera **untested on a phone** |
| Profile (F): interests, learned affinities, ranked places with changes, offline mode, consent, reset | Implemented, browser-tested |
| Neural personalisation (PyTorch MLP, TS inference) | Implemented; parity-tested against PyTorch and ONNX |
| Preference learning (like, save, visited, read more, skip, not for me) | Implemented, unit-tested |
| Route optimiser, 3 modes, time budget | Implemented, unit-tested (deterministic, budget respected) |
| Pedestrian routing: Valhalla → OSRM foot → labelled estimate | Partial: parsing tested on a recorded real Valhalla response; live calls not possible from the build sandbox |
| TRAILS A* router on a bundled OSM street graph | Implemented and bundled: `public/data/walk_graph.json` (65,014 nodes, 2,040 street names, central Rome, OpenStreetMap via Overpass, fetched 2026-10-16). Used first in auto mode, so routes follow real streets even offline; browser-tested |
| Walking-time matrix for stop selection | Implemented with real Valhalla data (`public/data/walk_matrix.json`) |
| Demo mode with simulated location and scenarios | Mocked/simulated by design, clearly labelled in the UI |
| AMD ROCm training | Script supports it; **untested on an AMD GPU** (none available) |

## 2. Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md). Static React app. All personalisation, optimisation and
recognition run in the browser; external services are only tiles and (optionally) live routing.

## 3. Main files

`src/lib/model` (MLP inference), `src/lib/optimizer.ts`, `src/lib/planner.ts`, `src/lib/routing/*`,
`src/lib/vision/*`, `src/screens/*`, `ml/*` (training), `data/rome/*` (dataset), `scripts/*`,
`tests/core.test.ts`. Full layout in the README.

## 4. Commands

```bash
npm install && npm run dev       # app
npm test                         # Vitest
npm run lint                     # oxlint
npm run validate:data            # dataset checks
npm run smoke                    # Playwright end-to-end (needs a running dev/preview server)
```

## 5. Build

`npm run build` → `dist/` (static). Main JS bundle 1,255 kB (296 kB gzip, more than half of it the bundled place dataset);
the MediaPipe library (154 kB) loads only when the camera opens; MediaPipe wasm, models,
photos and data are separate static files.

## 6. Training

`python ml/generate_data.py && python ml/train.py && python ml/check_export.py`. Run on CPU: 26 epochs
(early stopping), 11.2 s. Outputs PyTorch, ONNX and JSON weights.

## 7. ROCm setup

[AMD_ROCM.md](AMD_ROCM.md). `train.py` detects ROCm via `torch.version.hip` and prints the device.
Not run on AMD hardware; no GPU numbers are claimed. CPU benchmark: 0.524 s per epoch on 240k rows.

## 8. Environment variables

`VITE_TILE_URL`, `VITE_TILE_ATTRIBUTION`, `VITE_VALHALLA_URL`, `VITE_OSRM_FOOT_URL`,
`VITE_EMBED_MODEL`. All optional, none secret. No API keys are used.

## 9. Offline use

Dataset, model, photos, recognition model and wasm runtime are bundled. Profile → Offline mode skips
live routing; stops use the bundled Valhalla matrix; the route line is then a dashed estimate labelled
"not a verified walking route" (or a real street route once `walk_graph.json` is built). Map tiles
need internet.

## 10. Demo steps

[DEMO.md](DEMO.md): indoor-safe, about 4 minutes, uses Demo mode and held-out photos.

## 11. Actual test results (run on 2026-10-16 in the build container)

* Vitest: **37 passed / 37** (18 Oct: optional JSON mode for the storyteller; 17 Oct: added storyteller fallback messages on static hosts and CORS allow-list; before that: trade-off, walk-mode cues, story-in-cue, taste shift).
* 17 Oct: on a static host the story card now explains in plain words that the AI storyteller is not reachable, instead of "story server answered 501". The story server accepts cross-origin calls from sites listed in `STORY_ALLOW_ORIGIN`; browser-tested with a separate site calling a stand-in model. Added since the first report: storyteller grounding and server tests (6),
  address search parsing, arbitrary-endpoint planning in all modes, pass-by behaviour, places-along-path (5).
  Original 19: (model parity with PyTorch, schema check, fallback scorer, preference
  learning, dataset integrity, optimiser budget/determinism/modes, offline planner, polyline decoding,
  recorded Valhalla response parsing, walk-graph A*). The recognition decision rule is covered by the
  browser evaluation, not by a unit test.
* `tsc -b`: no errors. `vite build`: OK. oxlint: 0 errors (a few React-style warnings remain).
* `validate_dataset.py`: OK; one warning: Piazza Navona and Four Rivers Fountain are closer than 15 m
  (intentional: the square and its fountain).
* Playwright smoke test, desktop 1366×860 and mobile 390×844: **all 9 checks passed on both**
  (home, preset plan, different interests → different stops, Roma Termini → Piazza Trilussa with
  address search and a map pin, storyteller against a local stand-in model, place details, simulated
  navigation, camera recognises a held-out photo, profile + about). The offline story fallback was
  also checked in the browser with no model configured.
  With the real walking matrix, Pantheon → Colosseum in 45 min gave: Ancient preset = Temple of
  Hadrian + Trajan's Column; Renaissance preset = Piazza della Rotonda + Trajan's Column.
* 18 Oct, re-run on Windows 11 / Node 24 with internet access: smoke test **10/10 checks on desktop
  and mobile** against (a) the production build served by the story server with a stand-in model,
  (b) the GitHub Pages build under `/trails/` with no story server (offline story fallback), and
  (c) `vite preview` with live CARTO tiles. Screenshots in `docs/screenshots` are from run (c):
  real map tiles, offline story. Ancient preset = Temple of Hadrian + Trajan's Column; Renaissance
  preset = Sant'Ignazio + San Marcello al Corso + Santa Maria di Loreto (the dataset grew to 269
  places since the first run).
* Preference MLP, held-out **synthetic** users: AUC 0.740 (rule baseline 0.709, popularity 0.504,
  simulator ceiling 0.869); NDCG@5 0.874 (rule 0.857, popularity 0.594, ceiling 1.000).
  Export parity: torch vs JSON 1.25e-6, torch vs ONNX 6e-8.
* Landmark recognition, 18 Oct (MobileNetV3-Small, 27 landmarks, 269 reference + 120 held-out photos
  + 30 unrelated): top-1 82.5 %; with threshold 0.54 and margin 0.04 (re-calibrated, unchanged):
  60.8 % correct, 1.7 % wrong (2 Trajan's Column photos), 37.5 % "not sure"; 10 % of unrelated photos
  falsely accepted; 170 ms per photo on a Windows laptop. New landmarks (Colosseum, Pantheon, Arch of
  Constantine, Trajan's Column, Four Rivers Fountain) use Wikimedia Commons photos checked by eye
  (`scripts/fetch_commons_landmarks.py`). Earlier 22-landmark run: 83.3 % top-1, 63.3 % correct,
  0 % wrong, 76 ms; MobileNetV3-Large on that set: 72.2 % correct, 4.4 % wrong, 169 ms.
* Dataset, 18 Oct: 465 places (74 curated + 391 imported, was 195). The import now also dates places
  that have no Wikidata inception or style, from an antiquity-only class (24 places) or the Wikipedia
  description (35); a sample was checked by hand and one rule was tightened ("an ancient church" is
  not Roman antiquity). Left out: 53 little-known sites that Wikipedia describes in the past tense
  (the first run sent the "Ancient stones" preset to the vanished Villa Publica), and the general
  "Catacombs of Rome" article. Two imports must now be 15 m apart (30 m from a curated place), so a
  church above a temple both stay. Of the earlier 269 places only Porta Caelimontana is gone, replaced
  by the Arch of Dolabella (the same structure, 0 m). New photos are resized to 720 px (80 kB average).
  Validator passes; main JS bundle 296 kB gzip (was 237 kB).

## 12. Known limitations

* Recommendation quality is measured only on synthetic users; no real-user study.
* No on-device retraining; learning works through the affinity inputs the network was trained on.
* The optimiser is a greedy heuristic, not an exact orienteering solver.
* The bundled street graph covers central Rome only (about 41.870–41.919 N, 12.444–12.507 E); outside it, without network, routes are labelled estimates.
* 465 places in central Rome only: 74 hand-curated, 391 imported automatically from Wikidata/Wikipedia (period from inception date or architectural style, else from an antiquity-only class or the Wikipedia description; importance from the number of Wikipedia language editions; not reviewed by hand).
* Possible near-duplicate photos between reference and test sets in GLDv2, so recognition accuracy
  may be optimistic. Rule-of-thumb threshold calibrated on reference photos only.

## 13. Camera and browser limitations

* Camera and GPS need HTTPS (or localhost) and user permission.
* Only 27 landmarks are recognisable; everything else should yield "not recognised", but 10 % of
  unrelated landmarks were falsely accepted in testing. Trajan's Column can be confused with the
  Column of Marcus Aurelius.
* The overlay is a 2D label on the best-matching region, not 3D AR tracking.
* Night, heavy occlusion and close-up details were not evaluated.
* Live-camera behaviour has not been tested on a physical phone.

## 14. Data sources

[DATA_SOURCES.md](DATA_SOURCES.md). All 74 place sources resolve to a live Wikipedia article (3 titles
were corrected after the first lookup returned 404); 72 coordinates come from Wikipedia, the Aventine
keyhole keeps its curated point because Wikipedia's coordinate is the villa, 129 m away; 70 places
have a licensed Wikipedia lead photo (CC BY, CC BY-SA, CC0 or public domain, credited in-app); the
Domus Aurea lead image was a floor plan and was left out, and places without a photo use their
landmark photos or a styled placeholder.

## 15. Deployment

Any HTTPS static host: `npm run build`, publish `dist/`. For a sub-path, `npx vite build --base=/trails/`.
`.github/workflows/pages.yml` runs the unit tests, builds for the repository sub-path with keyless
OpenStreetMap tiles and publishes to GitHub Pages on every push to `main`.

## 16. Next steps

1. Run the storyteller on AMD Developer Cloud and record latency and sample stories (scripts and steps ready: [AMD_RUNBOOK.md](AMD_RUNBOOK.md)).
2. Refresh the Rome street graph periodically (`scripts/fetch_more_places.py --skip wikidata wiki images`, then `node scripts/build_walk_graph.mjs`).
3. Run `ml/train.py` and `ml/benchmark.py` on AMD Developer Cloud and commit the GPU benchmark.
4. Field-test GPS navigation and the live camera on phones in Rome.
5. Collect real (consented) interaction data to replace the synthetic bootstrap.
6. More landmarks and reference photos; deduplicate the test split.

## Hackathon requirements check

Checked against the official page (https://lablab.ai/event/amd-developer-hackathon-act-iii, read
2026-10-16; quotes in `data/open/hackathon_requirements.md`, not shipped with the app).

| Requirement | Status |
| --- | --- |
| "AMD technology should power a meaningful part" and "must be part of the working product shown to the judges" | **Met for the storyteller** (18 Oct): every AI story is written by Gemma 4 31B on the AMD Developer Cloud Token Factory (AMD GPUs), and the story card shows that model and provider. Measured on 5 fixed walks: 5/5 succeeded, 17/17 stops covered, 0 walks with numbers outside the supplied facts, median 21.6 s, max 49.7 s, about 10–26 output tokens/s seen from the client (`docs/story_eval_Gemma-4-31B-IT.json`). Still open: `amd/train_rocm.sh` (preference model on an AMD GPU) needs a ROCm instance. |
| Public GitHub repository | Done: https://github.com/LexaPankov/trails |
| Demo application URL | GitHub Pages workflow ready (section 15) |
| Cover image, video, slides, descriptions | Cover, slides and texts prepared by the team (outside the repo); video after the AMD run |
| "Submissions must be original and MIT-compliant" | Code is MIT; third-party assets are CC BY / CC BY-SA / CC0 / PD / Apache 2.0 / OFL with credits |
| Gemma (Google prize, optional) | Done: the storyteller runs Gemma 4 31B (`Gemma-4-31B-IT`) on AMD |
