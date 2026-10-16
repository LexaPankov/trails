#!/usr/bin/env python3
"""
Step 1 of the offline pipeline: collect historic places around a city centre.

Sources (no API keys needed):
  - Wikidata SPARQL: items with coordinates near the centre that have an English Wikipedia article
  - Wikipedia API: the plain-text intro of each article, the source text for step 2

Output: scripts/pipeline/out/raw_places.json

Usage:
  python3 scripts/pipeline/fetch_places.py --lat 45.4641 --lon 9.1900 --radius-km 2.2 --min-sitelinks 8
Standard library only. Needs internet access to query.wikidata.org and en.wikipedia.org.
"""
import argparse, json, os, sys, time, urllib.parse, urllib.request

UA = "EchoWalk-hackathon/0.1 (offline data pipeline)"
OUT_DIR = os.path.join(os.path.dirname(__file__), "out")

# Building/monument-like classes; anything that is a subclass of these is kept.
KEEP_CLASSES = [
    "wd:Q811979",   # architectural structure
    "wd:Q4989906",  # monument
    "wd:Q839954",   # archaeological site
    "wd:Q33506",    # museum
    "wd:Q16970",    # church building
    "wd:Q174782",   # square
]

QUERY = """
SELECT ?item ?itemLabel ?lat ?lon ?links ?article ?image ?inception WHERE {
  SERVICE wikibase:around {
    ?item wdt:P625 ?loc .
    bd:serviceParam wikibase:center "Point(%(lon)f %(lat)f)"^^geo:wktLiteral ;
                    wikibase:radius "%(radius)f" .
  }
  ?item wikibase:sitelinks ?links . FILTER(?links >= %(minlinks)d)
  ?item wdt:P31/wdt:P279* ?cls . VALUES ?cls { %(classes)s }
  ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> .
  OPTIONAL { ?item wdt:P18 ?image }
  OPTIONAL { ?item wdt:P571 ?inception }
  BIND(geof:latitude(?loc) AS ?lat) BIND(geof:longitude(?loc) AS ?lon)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
}
"""


def get_json(url, data=None, timeout=60, retries=3):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001
            if attempt == retries - 1:
                raise
            print(f"  retrying after error: {e}", file=sys.stderr)
            time.sleep(2 * (attempt + 1))


def fetch_wikidata(lat, lon, radius_km, min_links):
    q = QUERY % {"lat": lat, "lon": lon, "radius": radius_km, "minlinks": min_links, "classes": " ".join(KEEP_CLASSES)}
    url = "https://query.wikidata.org/sparql?" + urllib.parse.urlencode({"query": q, "format": "json"})
    rows = get_json(url, timeout=90)["results"]["bindings"]
    places = {}
    for r in rows:
        qid = r["item"]["value"].rsplit("/", 1)[-1]
        if qid in places:  # duplicates come from multiple classes / images
            continue
        title = urllib.parse.unquote(r["article"]["value"].rsplit("/wiki/", 1)[-1])
        places[qid] = {
            "qid": qid,
            "name": r["itemLabel"]["value"],
            "lat": round(float(r["lat"]["value"]), 6),
            "lon": round(float(r["lon"]["value"]), 6),
            "sitelinks": int(r["links"]["value"]),
            "wikiTitle": title,
            "wikiUrl": r["article"]["value"],
            "image": r.get("image", {}).get("value"),
            "inception": r.get("inception", {}).get("value"),
        }
    return list(places.values())


def fetch_extracts(places):
    for i in range(0, len(places), 20):
        batch = places[i:i + 20]
        params = {
            "action": "query", "format": "json", "prop": "extracts", "exintro": 1, "explaintext": 1,
            "redirects": 1, "titles": "|".join(p["wikiTitle"].replace("_", " ") for p in batch),
        }
        data = get_json("https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode(params))
        by_title = {}
        norm = {n["from"]: n["to"] for n in data["query"].get("normalized", []) + data["query"].get("redirects", [])}
        for page in data["query"]["pages"].values():
            by_title[page.get("title")] = page.get("extract", "")
        for p in batch:
            t = p["wikiTitle"].replace("_", " ")
            p["extract"] = by_title.get(norm.get(t, t), "")
        print(f"  extracts {min(i + 20, len(places))}/{len(places)}")
        time.sleep(0.5)
    return places


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lat", type=float, default=45.4641)
    ap.add_argument("--lon", type=float, default=9.1900)
    ap.add_argument("--radius-km", type=float, default=2.2)
    ap.add_argument("--min-sitelinks", type=int, default=8)
    args = ap.parse_args()

    print("Querying Wikidata…")
    places = fetch_wikidata(args.lat, args.lon, args.radius_km, args.min_sitelinks)
    print(f"  {len(places)} candidate places")
    print("Fetching Wikipedia intros…")
    places = [p for p in fetch_extracts(places) if len(p.get("extract", "")) > 200]
    print(f"  {len(places)} places with usable text")

    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, "raw_places.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"center": [args.lat, args.lon], "places": places}, f, ensure_ascii=False, indent=1)
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
