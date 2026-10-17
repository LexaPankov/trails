#!/usr/bin/env python3
"""Fetch candidate cultural places and the Rome walking network for TRAILS (needs internet).

    python3 scripts/fetch_more_places.py --out data/open [--skip wikidata wiki images osm]

Writes under --out:
  wikidata_candidates.json  Every Wikidata item with coordinates in the TRAILS bounding box that has an
                            English Wikipedia article (classes, architectural styles, inception, sitelinks).
  more_wikipedia.json       Wikipedia REST summary for the candidates that pass the cultural-class filter.
  more_images/<qid>.jpg     Licensed lead thumbnails (CC / public domain only) + more_images/attribution.json
  osm_walk.json             Walkable OSM ways + nodes, fetched as 4 tiles and merged (for build_walk_graph.mjs).

Standard library only. Every request sends a descriptive User-Agent and is rate limited.
"""
import argparse, json, os, sys, time, urllib.error, urllib.parse, urllib.request

UA = "TRAILS-hackathon-data-fetch/1.2 (https://github.com/LexaPankov/trails; open-source cultural navigation prototype)"
BBOX = (41.872, 12.448, 41.915, 12.502)  # south, west, north, east (same as fetch_open_data.py)
CULTURAL = (
    "church", "basilica", "chapel", "oratory", "cathedral", "temple", "palace", "palazzo", "villa", "fountain",
    "monument", "memorial", "statue", "sculpture", "obelisk", "column", "arch", "gate", "wall", "bridge",
    "archaeological", "ruin", "museum", "gallery", "theatre", "theater", "amphitheatre", "circus", "bath",
    "tomb", "mausoleum", "catacomb", "square", "piazza", "street", "staircase", "steps", "garden", "park",
    "library", "college", "convent", "monastery", "cloister", "synagogue", "tower", "castle", "fortification",
    "forum", "aqueduct", "portico", "insula", "domus", "mithraeum", "building", "house", "cemetery", "market",
)


def get(url, data=None, timeout=90, raw=False, accept="application/json", tries=6):
    """GET/POST with polite retries: 429/503 back off (Retry-After when given), other errors raise."""
    for n in range(tries):
        req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, "Accept": accept})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read()
                return body if raw else json.loads(body)
        except urllib.error.HTTPError as err:
            if err.code not in (429, 503) or n == tries - 1:
                raise
            wait = int(err.headers.get("Retry-After") or 0) or 5 * 2 ** n
            print(f"[wait] {err.code}, retrying in {min(wait, 120)} s", flush=True)
            time.sleep(min(wait, 120))


def wikidata(out):
    s, w, n, e = BBOX
    q = f"""
SELECT ?item ?label ?lat ?lon ?article ?sitelinks ?inception ?image
       (GROUP_CONCAT(DISTINCT ?classLabel; separator="|") AS ?classes)
       (GROUP_CONCAT(DISTINCT ?styleLabel; separator="|") AS ?styles) WHERE {{
  SERVICE wikibase:box {{
    ?item wdt:P625 ?coord.
    bd:serviceParam wikibase:cornerSouthWest "Point({w} {s})"^^geo:wktLiteral.
    bd:serviceParam wikibase:cornerNorthEast "Point({e} {n})"^^geo:wktLiteral.
  }}
  ?article schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>.
  ?item wikibase:sitelinks ?sitelinks; wdt:P31 ?class; rdfs:label ?label.
  FILTER(lang(?label) = "en")
  ?class rdfs:label ?classLabel. FILTER(lang(?classLabel) = "en")
  OPTIONAL {{ ?item wdt:P149 ?style. ?style rdfs:label ?styleLabel. FILTER(lang(?styleLabel) = "en") }}
  OPTIONAL {{ ?item wdt:P571 ?inception }}
  OPTIONAL {{ ?item wdt:P18 ?image }}
  BIND(geof:latitude(?coord) AS ?lat) BIND(geof:longitude(?coord) AS ?lon)
}} GROUP BY ?item ?label ?lat ?lon ?article ?sitelinks ?inception ?image"""
    url = "https://query.wikidata.org/sparql?" + urllib.parse.urlencode({"query": q, "format": "json"})
    rows = get(url, timeout=180, accept="application/sparql-results+json")["results"]["bindings"]
    items = {}
    for r in rows:
        qid = r["item"]["value"].rsplit("/", 1)[1]
        v = lambda k: r.get(k, {}).get("value")
        it = items.setdefault(qid, {"qid": qid, "label": v("label"), "lat": float(v("lat")), "lon": float(v("lon")),
                                    "article": v("article"), "sitelinks": int(v("sitelinks")), "classes": [],
                                    "styles": [], "inception": v("inception"), "image": v("image")})
        for c in (v("classes") or "").split("|"):
            if c and c not in it["classes"]: it["classes"].append(c)
        for c in (v("styles") or "").split("|"):
            if c and c not in it["styles"]: it["styles"].append(c)
    res = sorted(items.values(), key=lambda x: -x["sitelinks"])
    json.dump(res, open(os.path.join(out, "wikidata_candidates.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"[wikidata] {len(res)} items with an English article in the box", flush=True)
    return res


def cultural(it):
    return any(k in c.lower() for c in it["classes"] for k in CULTURAL)


def wiki(cands, out, limit):
    path = os.path.join(out, "more_wikipedia.json")
    res = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {}  # resumable: keep entries that already loaded
    for it in [c for c in cands if cultural(c)][:limit]:
        if res.get(it["qid"], {}).get("status") == "ok":
            continue
        title = urllib.parse.unquote(it["article"].rsplit("/wiki/", 1)[1])
        e = {"qid": it["qid"], "title": title, "url": it["article"]}
        try:
            s = get("https://en.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(title, safe=""))
            e.update(status="ok", resolved_title=s.get("title"), description=s.get("description"),
                     extract=s.get("extract"), coordinates=s.get("coordinates"), type=s.get("type"))
        except urllib.error.HTTPError as err:
            e.update(status=f"http_{err.code}")
        except Exception as err:
            e.update(status="error", error=str(err))
        res[it["qid"]] = e
        print(f"[wiki] {it['qid']:<11} {e['status']:<7} {title}", flush=True)
        if len(res) % 25 == 0:
            json.dump(res, open(path, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
        time.sleep(0.6)
    json.dump(res, open(path, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    return res


def images(cands, wk, out):
    d = os.path.join(out, "more_images"); os.makedirs(d, exist_ok=True)
    ap = os.path.join(d, "attribution.json")
    attrib = json.load(open(ap, encoding="utf-8")) if os.path.exists(ap) else {}  # resumable
    for it in cands:
        if (wk.get(it["qid"]) or {}).get("status") != "ok" or not it.get("image") or it["qid"] in attrib:
            continue
        fname = urllib.parse.unquote(it["image"].rsplit("/", 1)[1])
        try:
            q = urllib.parse.urlencode({"action": "query", "format": "json", "prop": "imageinfo", "titles": "File:" + fname,
                                        "iiprop": "url|extmetadata|mime", "iiurlwidth": 800})
            page = next(iter(get("https://commons.wikimedia.org/w/api.php?" + q)["query"]["pages"].values()))
            ii = page["imageinfo"][0]
            meta = ii.get("extmetadata", {})
            lic = (meta.get("LicenseShortName") or {}).get("value", "")
            if not any(k in lic.lower() for k in ("cc", "public domain", "pd")):
                print(f"[img] skip {it['qid']}: licence '{lic}'"); continue
            if ii.get("mime") not in ("image/jpeg", "image/png", "image/webp", "image/tiff"):
                print(f"[img] skip {it['qid']}: {ii.get('mime')}"); continue
            open(os.path.join(d, it["qid"] + ".jpg"), "wb").write(get(ii.get("thumburl") or ii["url"], raw=True))
            attrib[it["qid"]] = {"file": "File:" + fname, "file_page": ii.get("descriptionurl"),
                                 "author_html": (meta.get("Artist") or {}).get("value"), "license": lic,
                                 "license_url": (meta.get("LicenseUrl") or {}).get("value")}
            print(f"[img] {it['qid']:<11} {lic}", flush=True)
        except Exception as err:
            print(f"[img] {it['qid']} failed: {err}")
        time.sleep(0.4)
    json.dump(attrib, open(ap, "w", encoding="utf-8"), indent=1, ensure_ascii=False)


ENDPOINTS = ("https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter",
             "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.kumi.systems/api/interpreter")


def osm(out, grid=4, rounds=3):
    """Walkable ways in a grid x grid set of tiles; each tile is cached in osm_tiles/ so reruns resume."""
    s, w, n, e = BBOX
    td = os.path.join(out, "osm_tiles"); os.makedirs(td, exist_ok=True)
    dy, dx = (n - s) / grid, (e - w) / grid
    tiles = [(round(s + i * dy, 5), round(w + j * dx, 5), round(s + (i + 1) * dy, 5), round(w + (j + 1) * dx, 5))
             for i in range(grid) for j in range(grid)]
    for rnd in range(rounds):
        missing = [k for k in range(len(tiles)) if not os.path.exists(os.path.join(td, f"{grid}_{k}.json"))]
        if not missing:
            break
        print(f"[osm] round {rnd + 1}: {len(missing)} of {len(tiles)} tiles to fetch", flush=True)
        for k in missing:
            t = tiles[k]
            q = f"""[out:json][timeout:90];
way["highway"~"^(footway|pedestrian|path|steps|living_street|residential|service|unclassified|tertiary|secondary|primary|track|cycleway|corridor)$"]
   ["access"!~"^(private|no)$"]["foot"!~"^(no)$"]({t[0]},{t[1]},{t[2]},{t[3]});
(._;>;);
out body;"""
            for ep in ENDPOINTS:
                try:
                    r = get(ep, data=urllib.parse.urlencode({"data": q}).encode(), timeout=150, tries=2)
                    json.dump(r["elements"], open(os.path.join(td, f"{grid}_{k}.json"), "w", encoding="utf-8"))
                    print(f"[osm] tile {k} ok from {ep}: {len(r['elements'])} elements", flush=True)
                    break
                except Exception as err:
                    print(f"[osm] tile {k} {ep} failed: {err}", flush=True)
                    time.sleep(5)
            time.sleep(3)
        time.sleep(30)
    missing = [k for k in range(len(tiles)) if not os.path.exists(os.path.join(td, f"{grid}_{k}.json"))]
    if missing:
        print(f"[osm] {len(missing)} tiles still missing ({missing}); rerun later to resume. osm_walk.json not written"); return
    nodes, ways = {}, {}
    for k in range(len(tiles)):
        for el in json.load(open(os.path.join(td, f"{grid}_{k}.json"), encoding="utf-8")):
            (nodes if el["type"] == "node" else ways)[el["id"]] = el
    json.dump({"elements": list(nodes.values()) + list(ways.values())}, open(os.path.join(out, "osm_walk.json"), "w", encoding="utf-8"))
    print(f"[osm] wrote osm_walk.json: {len(nodes)} nodes, {len(ways)} ways")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/open")
    ap.add_argument("--limit", type=int, default=450, help="max cultural candidates to fetch summaries for")
    ap.add_argument("--skip", nargs="*", default=[], choices=["wikidata", "wiki", "images", "osm"])
    ap.add_argument("--images-for-imported", action="store_true",
                    help="only fetch lead images for places already imported into data/rome/places.json "
                         "(run merge_more_places.py first, then merge again to copy the images in)")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    cp = os.path.join(a.out, "wikidata_candidates.json")
    cands = wikidata(a.out) if "wikidata" not in a.skip else json.load(open(cp, encoding="utf-8"))
    wp = os.path.join(a.out, "more_wikipedia.json")
    wk = wiki(cands, a.out, a.limit) if "wiki" not in a.skip else json.load(open(wp, encoding="utf-8"))
    if "images" not in a.skip:
        if a.images_for_imported:
            root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            places = json.load(open(os.path.join(root, "data", "rome", "places.json"), encoding="utf-8"))["places"]
            have = json.load(open(os.path.join(root, "data", "rome", "place_images.json"), encoding="utf-8"))
            imported = {p.get("wikidata") for p in places if p.get("origin") == "wikidata" and p["id"] not in have}
            cands = [c for c in cands if c["qid"] in imported]
        images(cands, wk, a.out)
    if "osm" not in a.skip:
        osm(a.out)
    print("done ->", a.out)


if __name__ == "__main__":
    sys.exit(main())
