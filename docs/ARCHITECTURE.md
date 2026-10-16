# TRAILS architecture

```
                 ┌──────────────────────── Browser (React + Vite + TypeScript) ────────────────────────┐
 interests,      │                                                                                     │
 reactions ────► │  profile.ts ── affinity rule ──┐                                                    │
 (localStorage)  │                                ▼                                                    │
                 │  model/mlp.ts  (PyTorch-trained MLP, JSON weights, ~1.5k params, pure TS)            │
                 │        │ relevance score per place                                                  │
                 │        ▼                                                                            │
 places.json ──► │  optimizer.ts  greedy insertion under a time budget (3 modes) ◄── walking costs ──┐ │
                 │        │ ordered stops                                                            │ │
                 │        ▼                                                                          │ │
                 │  routing/index.ts  provider chain + timeout + cache                               │ │
                 │     1. walkGraph.ts   TRAILS A* on bundled OSM street graph (offline)  ───────────┤ │
                 │     2. Valhalla pedestrian (FOSSGIS)    3. OSRM foot (FOSSGIS)                    │ │
                 │     4. estimate (straight line × 1.35, labelled)                                  │ │
                 │        │                       walk_matrix.json (Valhalla, place↔place) ──────────┘ │
                 │        ▼                                                                            │
                 │  planner.ts  re-checks the budget with real router durations, drops stops if needed │
                 │        ▼                                                                            │
                 │  Leaflet map · stop cards · navigation (GPS with consent, or simulated walk)        │
                 │                                                                                     │
 camera / photo ►│  vision/embedder.ts  MediaPipe MobileNetV3 embedder (wasm, CPU)                     │
                 │  vision/recognizer.ts  6 crops → cosine vs reference index → threshold + margin    │
                 │        ▼ placeId (same id as places.json)                                           │
                 │  AR-style label on best region → popup → place page with sources                    │
                 └─────────────────────────────────────────────────────────────────────────────────────┘

 Offline (Python / Node):
   ml/generate_data.py → ml/train.py (CPU or AMD ROCm) → ONNX + public/models/preference_mlp.json
   scripts/prepare_landmark_images.py (GLDv2 photos, licences) → scripts/vision_eval.mjs → public/vision/reference_index.json
   scripts/fetch_open_data.py (Wikipedia, Commons, Overpass, Valhalla) → scripts/apply_open_data.py / build_walk_graph.mjs
```

## Shared identifiers

Every place has a stable `id` (e.g. `trevi-fountain`). The same id keys the knowledge base
(`data/rome/places.json`), the walking matrix, the landmark photos and recognition index, the user's
saved/dismissed lists and interaction log. Changing an id is a breaking change.

## Preference model

* Input (schema `trails-pref-v1`, 29 features): 8 selected interests (0/1), 8 learned affinities
  ([-1, 1]), 5 period flags, 5 theme flags, hidden-gem flag, significance, visit time.
* Network: Linear(29→32) → ReLU → Linear(32→16) → ReLU → Linear(16→1) → sigmoid.
* Trained with BCE on synthetic interactions (see `ml/generate_data.py` for the simulator). Users
  are split 70/15/15 so test users are never seen in training. Early stopping on validation log-loss.
* Detour cost is deliberately **not** a model input: the optimiser already charges for walking, so
  adding it to the model would count travel cost twice.
* Fallback: if the weights fail to load or mismatch the schema, a transparent rule-based scorer is
  used and the UI says so.

## Preference learning

`affinity[k] += w(signal) · axes_k(place) / √(Σ axes)`, clipped to [-1, 1]. Weights: like +0.35,
save +0.25, visited +0.20, read more +0.08, skip −0.04, not for me −0.35. The same rule generated the
training data, so the network has learned how to use these values. No retraining happens on device.

## Route optimiser

Deterministic greedy insertion (an orienteering heuristic):

* `value = a · personal + (1 − a) · significance` (+0.1 if saved), with `a` = 0.7 (0.5 in Maximum history).
* Diversity damping: ×0.45 for a stop within 110 m of a chosen stop, ×0.85 per chosen stop of the same category.
* `gain = W · value − λ_walk · extra_walk_min − λ_visit · visit_min`; the best positive gain over all
  insertion positions is added while `walk + visits ≤ cap`.
* Modes: Fastest (W 6, max 2 stops, uses ≤35 % of spare time), Discovery (W 10, ≤6 stops), Maximum
  history (W 14, ≤10 stops). Thresholds on value and on the model's personal score keep weak stops out.
* After routing, the planner re-checks the budget with the router's real durations and drops the
  lowest value-per-minute stop until the plan fits.

## Vision

* Embedder: MediaPipe Image Embedder with MobileNetV3-Small (1024-d, L2-normalised), CPU/wasm.
* Index: each reference photo is embedded whole and as a 75 % centre crop; vectors are int8-quantised.
* Query: whole frame, centre crop and four quadrant crops; a landmark's score is the mean of its top-2
  reference similarities; best region positions the label.
* Decision: `recognized` if score ≥ threshold and lead over the runner-up ≥ margin; `uncertain` just
  below; otherwise `unknown`. Threshold and margin are calibrated on reference photos only.
* Live camera: 2-of-3 frame agreement before a label is shown. Optional 2 km location filter.
