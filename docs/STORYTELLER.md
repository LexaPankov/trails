# AI storyteller on AMD (Gemma via vLLM on ROCm)

"Every route has a story": after TRAILS plans a walk, the storyteller writes one connected narrative
across the stops, using only the sourced notes in `data/rome/places.json`, with numbered citations.

## How it works

```
browser ──POST /api/story {stopIds, start, end, interests}──► server/story-server.ts
          (no key in the app)                                 │  builds a grounded prompt from places.json
                                                               ▼
                                         OpenAI-compatible endpoint (vLLM on AMD Instinct, ROCm)
                                                               │  JSON {title, intro, segments[], outro}
                                                               ▼
                       validation: unknown places dropped, citations outside the supplied sources dropped
```

* The model only receives the facts of the chosen stops and is told to add nothing else.
* `parseStory` rejects output with no usable segments; the app then shows a deterministic
  offline story assembled from the same notes, labelled "Offline story from TRAILS notes (no AI)".
* The badge in the app shows the model id the endpoint returned and `STORY_PROVIDER_LABEL`, so what
  the judges see is what actually ran.

## Run the model on AMD Developer Cloud (not yet run by us)

On an AMD Instinct instance with ROCm (Gemma needs its licence accepted on Hugging Face and an `HF_TOKEN`):

```bash
docker run -it --rm --device=/dev/kfd --device=/dev/dri --group-add video --ipc=host \
  -p 8000:8000 -e HF_TOKEN=$HF_TOKEN rocm/vllm:latest \
  vllm serve google/gemma-3-12b-it --max-model-len 8192
curl http://localhost:8000/v1/models          # check it answers
```

Any OpenAI-compatible endpoint works the same way (for example an AMD-hosted inference API, if your
event account provides one).

## Run TRAILS with the storyteller

```bash
npm run build
STORY_API_BASE=http://<amd-host>:8000/v1 \
STORY_MODEL=google/gemma-3-12b-it \
STORY_PROVIDER_LABEL="Gemma 3 12B · vLLM on AMD Instinct (ROCm)" \
npm run story          # serves the app and /api on http://localhost:8787
```

## One HTTPS link with the AMD storyteller (phone and laptop)

The story server also serves the built app, so the simplest live demo is one HTTPS link to it. Run
`npm run story` as above (on the laptop with an SSH tunnel to the AMD host, or on the AMD host
itself), then open a free Cloudflare quick tunnel to it:

```bash
npx cloudflared tunnel --url http://localhost:8787     # or: docker run --network host cloudflare/cloudflared tunnel --url http://localhost:8787
```

It prints an `https://<random>.trycloudflare.com` link. Open it on the phone: the camera works (HTTPS)
and every story comes from Gemma on AMD. The link changes on every run and stops when you stop the
command, so keep the static site below as the permanent demo URL for the submission form.

## Using the storyteller from the static demo site

A static host (Netlify, GitHub Pages) has no `/api`, so the static site always tells the offline
story and says, in plain words, that the AI storyteller is not reachable from that site. To let it
call a story server running elsewhere:

1. Start the story server with the site's origin allowed:
   `STORY_ALLOW_ORIGIN=https://<your-site>.netlify.app npm run story` (comma-separate several sites; `*` allows any).
2. Make the story server reachable over HTTPS (the tunnel above); a browser blocks an `http://` API from an `https://` page.
3. Rebuild the site with `VITE_STORY_API=https://<tunnel-or-host>/api npm run build` and redeploy `dist/`.

Only allowed origins get CORS headers; preflight requests from any other site are refused with 403.

On Windows PowerShell set the variables with `$env:STORY_API_BASE="..."` first. During development run
`npm run story` and `npm run dev` side by side; Vite forwards `/api` to port 8787.

| Variable | Purpose |
| --- | --- |
| `STORY_API_BASE` | OpenAI-compatible base URL ending in `/v1` |
| `STORY_MODEL` | model id served there |
| `STORY_API_KEY` | only if the endpoint needs one; stays on the server |
| `STORY_PROVIDER_LABEL` | text shown in the app badge; describe the real hardware |
| `PORT`, `STORY_TIMEOUT_MS` | server port (8787), model timeout (45000) |
| `STORY_JSON_MODE` | `1` asks the endpoint for `response_format: json_object` (supported by vLLM and OpenAI) |
| `STORY_ALLOW_ORIGIN` | sites allowed to call `/api` from another origin (comma-separated, or `*`); unset = same origin only |
| `VITE_STORY_API` | build-time, in the app: where the app sends story requests (default `/api`) |

## What is tested

* Unit tests: prompt contains only dataset facts; bad places, duplicate places and invented
  citations are removed; empty output is rejected; the server refuses unknown place ids before any
  model call; an OpenAI-style response is parsed and labelled.
* Browser smoke test: the full flow against a local stand-in model (desktop and mobile), and the
  offline fallback with no model configured.
* **Not tested:** a real Gemma model on AMD hardware, story quality and latency. Measure these on AMD
  Developer Cloud before quoting them.
