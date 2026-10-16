#!/usr/bin/env python3
"""
Step 2 of the offline pipeline: turn raw Wikipedia text into EchoWalk place cards with an open LLM.

Run this on AMD Developer Cloud (ROCm) against a vLLM server, which exposes an OpenAI-compatible API:

  vllm serve Qwen/Qwen2.5-7B-Instruct --port 8000          # on the MI300X instance
  export LLM_BASE_URL=http://localhost:8000/v1
  export LLM_MODEL=Qwen/Qwen2.5-7B-Instruct
  python3 scripts/pipeline/enrich_llm.py --merge

The model only rewrites and classifies the Wikipedia text it is given. It is told not to add facts.
Results are cached in out/enriched_cache.json so you can stop and resume.
Writes public/data/places.json, which the app reads. The app never calls the model.

--mock fills the fields without a model (first sentences of the text). Use it to test the plumbing.
Standard library only.
"""
import argparse, concurrent.futures as cf, json, os, re, sys, unicodedata, urllib.request

HERE = os.path.dirname(__file__)
RAW = os.path.join(HERE, "out", "raw_places.json")
CACHE = os.path.join(HERE, "out", "enriched_cache.json")
TARGET = os.path.join(HERE, "..", "..", "public", "data", "places.json")
THEMES = ["antiquity", "medieval", "renaissance", "baroque", "modern", "hidden"]

SYSTEM = (
    "You write short, accurate texts for a historical walking app. "
    "Use ONLY facts stated in the source text. Never invent dates, names, quotes or numbers. "
    "If the source does not support a field, write a cautious, general sentence instead of guessing. "
    "Reply with a single JSON object and nothing else."
)

USER_TMPL = """Place: {name}
Source text (Wikipedia intro):
\"\"\"{extract}\"\"\"

Return JSON with these keys:
- "period": short label like "Renaissance, begun 1503" (max 40 chars)
- "themes": array, subset of {themes}. Use "hidden" only for places most tourists walk past.
- "significance": integer 1-5 (5 = world-famous landmark, 1 = minor local site)
- "summary": 2 sentences, max 45 words
- "then": 1-2 sentences about its history, max 40 words
- "now": 1-2 sentences about what is there today, max 40 words
- "more": 3-4 sentences with further detail, max 90 words
"""


def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60]


def call_llm(name, extract):
    base = os.environ.get("LLM_BASE_URL", "http://localhost:8000/v1").rstrip("/")
    model = os.environ.get("LLM_MODEL", "Qwen/Qwen2.5-7B-Instruct")
    body = {
        "model": model,
        "temperature": 0.2,
        "max_tokens": 700,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": USER_TMPL.format(name=name, extract=extract[:4000], themes=THEMES)},
        ],
    }
    headers = {"Content-Type": "application/json"}
    if os.environ.get("LLM_API_KEY"):
        headers["Authorization"] = "Bearer " + os.environ["LLM_API_KEY"]
    req = urllib.request.Request(base + "/chat/completions", data=json.dumps(body).encode(), headers=headers)
    with urllib.request.urlopen(req, timeout=120) as r:
        text = json.load(r)["choices"][0]["message"]["content"]
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError("model did not return JSON")
    return json.loads(m.group(0))


def mock_llm(name, extract):
    sents = re.split(r"(?<=[.!?])\s+", extract.strip())
    year = re.search(r"\b(1[0-9]{3}|[2-9][0-9]{2})\b", extract)
    return {
        "period": f"c. {year.group(1)}" if year else "Historic site",
        "themes": [], "significance": 3,
        "summary": " ".join(sents[:2]), "then": " ".join(sents[2:3]), "now": " ".join(sents[3:4]),
        "more": " ".join(sents[4:8]),
    }


def clean(raw_place, gen):
    """Validate model output; returns a place dict for places.json or raises."""
    themes = [t for t in gen.get("themes", []) if t in THEMES]
    sig = gen.get("significance", 3)
    sig = int(sig) if isinstance(sig, (int, float)) else 3
    summary = str(gen.get("summary", "")).strip()
    if len(summary) < 20:
        raise ValueError("summary missing")
    image = raw_place.get("image")
    if image and "Special:FilePath" in image:
        image += "?width=900"
    return {
        "id": slug(raw_place["name"]),
        "name": raw_place["name"],
        "lat": raw_place["lat"], "lon": raw_place["lon"],
        "period": str(gen.get("period", "")).strip()[:60] or "Historic site",
        "themes": themes,
        "significance": max(1, min(5, sig)),
        "hidden": "hidden" in themes,
        "summary": summary,
        "then": str(gen.get("then", "")).strip(),
        "now": str(gen.get("now", "")).strip(),
        "more": str(gen.get("more", "")).strip(),
        "wikiQuery": raw_place["wikiTitle"].replace("_", " "),
        "wikiUrl": raw_place["wikiUrl"],
        "wikidata": raw_place["qid"],
        **({"image": image} if image else {}),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mock", action="store_true", help="no model; test the plumbing")
    ap.add_argument("--merge", action="store_true", help="keep existing hand-curated places and add new ones")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--raw", default=RAW)
    ap.add_argument("--out", default=TARGET)
    args = ap.parse_args()

    raw = json.load(open(args.raw, encoding="utf-8"))
    cache = json.load(open(CACHE, encoding="utf-8")) if os.path.exists(CACHE) and not args.mock else {}
    fn = mock_llm if args.mock else call_llm
    todo = [p for p in raw["places"] if p["qid"] not in cache]
    print(f"{len(raw['places'])} places, {len(todo)} to generate")

    def work(p):
        try:
            return p["qid"], fn(p["name"], p["extract"]), None
        except Exception as e:  # noqa: BLE001
            return p["qid"], None, str(e)

    with cf.ThreadPoolExecutor(max_workers=args.workers) as ex:
        for i, (qid, gen, err) in enumerate(ex.map(work, todo), 1):
            if err:
                print(f"  [{i}/{len(todo)}] {qid} failed: {err}", file=sys.stderr)
                continue
            cache[qid] = gen
            if i % 10 == 0 and not args.mock:
                json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)
            print(f"  [{i}/{len(todo)}] {qid} ok")
    if not args.mock:
        json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)

    new_places, skipped = [], 0
    for p in raw["places"]:
        if p["qid"] not in cache:
            continue
        try:
            new_places.append(clean(p, cache[p["qid"]]))
        except ValueError:
            skipped += 1

    existing = json.load(open(args.out, encoding="utf-8")) if os.path.exists(args.out) else None
    if existing and args.merge:
        have_ids = {p["id"] for p in existing["places"]}
        have_names = {p["name"].lower() for p in existing["places"]}
        added = [p for p in new_places if p["id"] not in have_ids and p["name"].lower() not in have_names]
        existing["places"].extend(added)
        result = existing
        print(f"Merged {len(added)} new places into {len(existing['places']) - len(added)} existing ones")
    else:
        result = existing or {"schemaVersion": 1, "city": {"id": "city", "name": "City", "center": raw["center"], "elevationData": False}}
        result["places"] = new_places
    result["source"] = {"generatedBy": "scripts/pipeline (Wikidata + Wikipedia, LLM on AMD Developer Cloud)" + (" [MOCK]" if args.mock else ""), "verified": False}
    json.dump(result, open(args.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"Wrote {args.out} ({len(result['places'])} places, {skipped} skipped as invalid)")


if __name__ == "__main__":
    main()
