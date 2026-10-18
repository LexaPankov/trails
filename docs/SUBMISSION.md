# TRAILS: submission kit (lablab.ai, AMD Developer Hackathon ACT III)

Everything to paste into the lablab.ai form, plus the video script. Numbers come from files in this repo;
where a number is our estimate or proposal, it says so.

## Form fields

**Project title:** TRAILS: Every route has a story

**Track / challenge:** Track 4, Create a New Kind of Experience. Also eligible for the Google prize (Gemma
on AMD GPUs).

**Short description** (one or two sentences):

> TRAILS turns any walk through Rome into a personal story: it picks the places worth a detour for your
> taste and time, and Gemma 4 31B on AMD GPUs writes and reads you the sourced story of your route as you
> walk.

**Long description:**

> Rome had a record 22.9 million arrivals in 2025, and most visitors walk the same few streets: more than
> 10 million people queued at the Trevi Fountain alone. Maps send you the fastest way and say nothing;
> audio guides cover one monument and are the same for everyone.
>
> TRAILS is a walking guide that is planned for you and told to you. You give any start, any destination
> and the time you have.
> - A small neural network on the phone ranks 465 historical places for your taste.
> - An optimiser picks the stops worth the detour, and a router follows real OpenStreetMap streets.
> - Then **Gemma 4 31B, running on AMD GPUs through the AMD Developer Cloud**, writes the story of exactly
>   this walk, with numbered sources.
> - As you walk, each stop and every place you pass is read aloud when you get close.
> - Point the camera at one of 27 landmarks and TRAILS recognises it in the browser and opens its history.
> - A short first-run intro asks what you love, and offers a one-tap demo mode if you are not in Rome.
> - Save walks to "My walks", or share a link that opens the same walk for a friend.
>
> The experience changes with the audience. With the same start, end and 45 minutes, a history lover
> gets the Temple of Hadrian and Trajan's Column and the story "Imperial Echoes", while an art lover gets
> three churches and the story "Baroque Splendor and Sacred Spaces". Every like or skip shifts the next
> walk.
>
> Quality control:
> - The model only receives facts from our own place records (74 written by hand, 391 imported from
>   Wikidata and Wikipedia and labelled), each with a source.
> - Every story is checked automatically: all stops covered, any number not in the facts flagged.
>   Measured on 5 fixed walks: 5/5 stories, 17/17 stops, 0 unsupported numbers, median 22 s.
> - If the model is slow, the app falls back to a pre-generated story or its own notes, so a walk never
>   breaks.
>
> Cost: one story uses about 1–1.6k tokens, well under a tenth of a cent at typical open-model prices
> (our estimate). Ranking, routing and recognition run on the phone for free.
>
> Who pays (our proposal):
> - hotels, as a branded walking concierge for their guests;
> - city tourism boards, to spread visitors away from hotspots;
> - travellers, through premium city story packs.
>
> Privacy: there is no account. Your taste, saved places and walks stay on your phone, and a shared walk
> link holds only the route.

**Technology tags:** AMD Developer Cloud, Gemma, Gemma 4, LLM, Generative AI, PyTorch, MediaPipe,
Computer Vision, React, TypeScript, Leaflet, OpenStreetMap, Wikidata, Text-to-Speech, PWA

**Links:**
- Application URL: https://lexapankov.github.io/trails/
- Public GitHub repository: https://github.com/LexaPankov/trails
- Demo platform: GitHub Pages (static site, works in any phone browser)

**Cover image:** `trails-cover.png`, 1920×1080 (from the team kit; it says "Gemma on AMD").

**Slides:** the TRAILS pitch deck (13 slides, with speaker notes). Export it as PDF and upload it.

## Business model (detail)

| Customer | What they get | How they pay (proposal) |
| --- | --- | --- |
| Hotels and short-stay hosts | Walks that start at their door, in their brand, for every guest | Monthly fee per property |
| City tourism boards | Visitors sent past lesser-known places, away from hotspots (TRAILS already weights hidden gems) | Yearly licence per city |
| Travellers | Core walk free; premium story packs and offline use | A few euros per city |
| Museums and sites on the route (later) | Ticket sales from walkers who pass by | Booking commission |

What supports it:
- **The need.** Rome had 22.9M arrivals in 2025 (Turismo Roma). Since February 2026 the city charges
  €2 for close access to the Trevi Fountain, which more than 10M people queued for in 2025 (city of Rome
  figures, reported by Il Sole 24 Ore and others). The city wants visitors spread out.
- **The price anchor.** Audio guides for a single monument sell for about €9–50 (Colosseum listings,
  Oct 2026).
- **Our cost.**
  - One AI story: about 400–1,100 prompt and 220–530 output tokens, measured
    (`docs/story_eval_Gemma-4-31B-IT.json`).
  - At $0.1–0.6 per million tokens, typical for hosted open models of this size, that is
    $0.0001–0.0005 per walk. This is our estimate; the Token Factory listed no price during the
    hackathon.
  - Cached walks cost nothing. Ranking, routing and recognition run on the user's phone.
- **Not validated yet.** We have not talked to customers. The taste model is trained on simulated users
  only.

## Demo video (about 2:30)

Record locally with `start-trails.cmd`, so stories are written live by Gemma on AMD and the badge shows
it. Use a phone-size browser window (Chrome DevTools → device toolbar → Pixel 7), or record the phone
screen.

| Time | Show | Say |
| --- | --- | --- |
| 0:00–0:15 | First-run intro (fresh browser): pick interests, "No, show me a demo" | "Millions visit Rome and walk the same few streets. TRAILS plans a walk for you and tells you its story. First, what do you love?" |
| 0:15–0:40 | Plan → preset **Ancient stones**; route, trade-off card | "Pantheon to the Colosseum, 45 minutes. A neural network on the phone picked the stops worth the detour for a history lover: the fastest walk is 29 minutes; this one adds 14 for two stops." |
| 0:40–1:10 | **Tell me the story**; wait; badge "Written by Gemma-4-31B-IT · … AMD"; tap **Listen** | "Gemma 4 31B on AMD GPUs now writes the story of exactly this walk, only from our sourced facts. Every fact has a numbered source." |
| 1:10–1:30 | Back; preset **Renaissance & Baroque** | "Same start, same end, same time, but for an art lover: different stops and a different story." |
| 1:30–1:55 | **Start walking**, play 20×, swipe the sheet down | "As you walk, each place is read aloud when you get close. Swipe down and it's just the map." |
| 1:55–2:10 | Camera → Demo photos (or live camera on a landmark photo) | "Point the camera at a landmark: it is recognised in the browser and its history opens." |
| 2:10–2:20 | Route → **Save walk**, **Share**; Profile → My walks | "Save a walk or share it with a friend. No account: everything stays on your phone." |
| 2:20–2:30 | Close slide with the links | "Try it now at lexapankov.github.io/trails. Every route has a story." |

Tips:
- Run the story once before recording, so the AMD endpoint is warm.
- If it takes long, cut the wait in editing.
- Keep the key out of the frame: never show `.env.local` or a terminal with the key.

## Before you press Submit

- [ ] Every team member is registered on lablab.ai, on Discord and in the AMD AI Developer Program
- [ ] The repo is public and the live site opens on a phone
- [ ] Video uploaded (YouTube unlisted or as the form asks), with the AMD badge visible
- [ ] Slides exported as PDF
- [ ] Track 4 selected, and the Google / Gemma option where the form offers it
