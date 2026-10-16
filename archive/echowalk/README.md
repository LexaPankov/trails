# EchoWalk

**See what you're walking past.** EchoWalk plans the walk with the most history in the time you have. Pick a start, a finish, how long you've got and what interests you, and it builds a walking route through landmarks and lesser-known places along the way. A camera view labels the historic places in front of you.

Built for the AMD Developer Hackathon: ACT III (Milan, October 2026).

## How it works

```
 OFFLINE, on AMD Developer Cloud (once)                 IN THE BROWSER (every time)
 ─────────────────────────────────────                  ──────────────────────────────
 Wikidata + Wikipedia ──► open LLM via vLLM on ROCm ──► public/data/places.json ──► route planner ──► map, cards, camera view
 (fetch_places.py)        (enrich_llm.py)               (static file)               (no AI at runtime)
```

- **No AI runs at runtime.** The app only reads `public/data/places.json`. The LLM writes the place texts ahead of time on AMD GPUs, so the demo can't break because a model is slow or down.
- **Works offline.** If the street-routing service or Wikipedia photos can't be reached, the app falls back to an estimated route and a text-only card, and labels that clearly.

## Run it

Requires Node 20+.

```bash
npm install
npm run dev        # http://localhost:5173, also on your LAN IP
npm test           # planner and dataset checks
npm run build      # production build in dist/
npm run preview    # serve the build locally
```

### Test on a phone

The camera, location and compass only work over **HTTPS** (or on localhost). The quickest way:

- **Netlify Drop:** run `npm run build`, then drag the `dist` folder onto https://app.netlify.com/drop. You get an HTTPS link in seconds.
- **Vercel:** `npx vercel` in this folder. It detects Vite automatically.

`vite.config.ts` uses `base: './'`, so the build also works from a sub-path such as GitHub Pages.

### Environment variables (optional)

| Variable | Default | Purpose |
|---|---|---|
| `VITE_OSRM_FOOT_URL` | `https://routing.openstreetmap.de/routed-foot/route/v1/foot` | Walking-route server. `router.project-osrm.org` only routes cars, so don't use it. |

No API keys are used in the frontend.

## Demo script (about 3 minutes)

1. **Home page.** Read the headline. Pick an example walk, or choose *Duomo → Castello Sforzesco, 1½ h, Renaissance + Hidden gems, Maximum history* and press **Plan my walk**.
2. **Route.** Point out the numbers in the summary: walk time, distance and number of discoveries. Bordeaux pins are landmarks and green pins are lesser-known places. Click a pin or a stop in the list to open its card.
3. **Card.** Show *Then / Now*, then **More information**, **Read aloud** and **Open on Wikipedia**.
4. **Personalisation.** Click **Change walk**, switch to *Only the highlights*, or change the theme to *Antiquity*, and plan again. The route changes completely.
5. **Camera.** Click **Camera view → Try the indoor demo**. It simulates standing in Piazza del Duomo facing north-east, so Galleria, La Scala, Palazzo Marino and others appear. Drag the view or use the slider to turn, and the Duomo comes into view around 90°. Tap a label, then tap **More info**.
6. **Pitch.** "We processed the city's history on AMD GPUs; the app runs offline from that."

**Before the demo:** load the app once on the venue Wi-Fi so photos and routes are cached, have a phone hotspot ready, and record a short backup video of the camera view working outdoors.

## Route planner

`src/lib/planner.ts`: greedy waypoint insertion, then a 2-opt pass to tidy the order.

- Value of a place = `significance/5 × theme relevance`. *Maximum history* boosts lesser-known places ×1.35. *Only the highlights* uses only places with significance ≥ 4 and squares significance.
- Score = value ÷ added minutes (detour + time at the stop), with a 2-minute floor so tiny detours don't dominate.
- A stop is only added if the whole walk still fits the time budget. If street routing then turns out longer than the estimate, the route is planned again with a smaller budget.
- Assumptions: 4.5 km/h walking, straight line × 1.3 for street distance, 4 min per stop (8 min for highlights). These appear in the UI and can be changed in `PLANNER_CONFIG`.
- **With climbs** is disabled for Milan because the centre is flat and the dataset has no elevation data. The UI says so instead of pretending.

## Camera view

`src/components/CameraMode.tsx`: camera background with a compass-driven overlay. There is no image recognition.

- Bearing from you to each place within 600 m is compared with the phone's heading. Places inside the field of view (default 60°) get a tappable label.
- The compass is smoothed (circular low-pass filter). iOS motion permission is requested from the Start tap. Android uses `deviceorientationabsolute`.
- Labels are spread across rows so they don't overlap. A mini radar and the edge counters show what's outside the view.
- **Indoor demo:** simulated position and heading, clearly marked in yellow. Turn by dragging, with the slider, or with the arrow keys.
- If the camera, location or compass is blocked or missing, the app explains what happened and you can drag to turn instead.

## Data

`public/data/places.json`. The current file is a **hand-curated seed dataset of 39 Milan places**. Coordinates are approximate (within roughly 50 m) and the texts stick to well-documented facts. Spot-check it, or replace it with pipeline output, before relying on it.

```jsonc
{
  "schemaVersion": 1,
  "city": { "id", "name", "center": [lat, lon], "elevationData": bool, "elevationNote", "demoViewpoint": { "name", "lat", "lon", "heading" } },
  "source": { "generatedBy", "note", "verified": bool },
  "places": [{
    "id": "duomo", "name": "...", "lat": 45.46, "lon": 9.19,
    "period": "Gothic · begun 1386",
    "themes": ["antiquity" | "medieval" | "renaissance" | "baroque" | "modern" | "hidden"],
    "significance": 1-5, "hidden": bool,
    "summary": "2–3 sentences", "then": "...", "now": "...", "more": "longer text",
    "wikiQuery": "search term for photo/link",   // optional
    "wikiUrl", "image", "audio", "wikidata"       // optional
  }]
}
```

The app validates the file when it loads and skips invalid entries, logging them to the console.

### Regenerating it on AMD Developer Cloud

```bash
# 1. on any machine with internet
python3 scripts/pipeline/fetch_places.py --lat 45.4641 --lon 9.1900 --radius-km 2.2

# 2. on the AMD MI300X instance (ROCm), start an open model with vLLM
#    e.g. the ROCm vLLM image: docker run -it --device=/dev/kfd --device=/dev/dri --group-add video \
#         --ipc=host -p 8000:8000 rocm/vllm:latest vllm serve Qwen/Qwen2.5-7B-Instruct
export LLM_BASE_URL=http://localhost:8000/v1
export LLM_MODEL=Qwen/Qwen2.5-7B-Instruct
python3 scripts/pipeline/enrich_llm.py --merge   # --merge keeps the hand-curated places

# test the plumbing without a GPU:
python3 scripts/pipeline/enrich_llm.py --mock --out /tmp/test.json
```

The model is told to use only facts from the Wikipedia text it is given. Results are cached in `scripts/pipeline/out/`, so a run can be resumed.

## Project layout

```
src/
  App.tsx                 home, route view, state
  types.ts                data model and themes
  lib/planner.ts          scoring and greedy route building
  lib/routing.ts          OSRM walking routes, cache and fallback
  lib/geo.ts              distance, bearing, heading smoothing
  lib/data.ts             loads and validates places.json
  lib/wiki.ts             optional Wikipedia photo and link (cached)
  components/Planner.tsx  the form
  components/MapView.tsx  Leaflet map
  components/PlaceSheet.tsx   place card / detail view
  components/CameraMode.tsx   camera view and indoor demo
scripts/pipeline/         offline data pipeline (Python, standard library only)
tests/planner.test.ts     npm test
```

## Known limitations

- The seed dataset was written by hand and has not been checked against the live Wikidata coordinates.
- The pipeline scripts have been checked with `--mock` but not run against Wikidata or a real vLLM server, because the build machine had no access to them.
- Real pedestrian routing, Wikipedia photos and map tiles need internet. Without it you get an estimated route, text-only cards and a blank map background, but the route line, pins and cards all still work.
- Real-device camera, GPS and compass behaviour wasn't tested on a physical phone. The browser tests covered the demo mode and permission-failure messages.
- Audio uses the browser's built-in speech (Read aloud). Pre-recorded clips are supported through the `audio` field but none are bundled.
