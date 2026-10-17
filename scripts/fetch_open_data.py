#!/usr/bin/env python3
"""Fetch open data that TRAILS bundles for offline use.

Run this on a machine with internet access (standard library only):

    python3 scripts/fetch_open_data.py --out data/open

It produces, under --out:
  wikipedia.json        Wikipedia summary for every place (coordinates, Wikidata QID,
                        lead image, HTTP status of each source URL).
  images/<id>.jpg       Lead image thumbnail (<= 800 px) from Wikimedia Commons, plus
  images/attribution.json  author / licence / file page for every downloaded image.
  osm_walk.json         Raw Overpass response: walkable OSM ways + nodes in central Rome
                        (consumed by scripts/build_walk_graph.mjs).
  valhalla_matrix.json  Pedestrian time/distance matrix between all places (Valhalla).
  valhalla_samples.json A few full Valhalla pedestrian routes, kept as test fixtures.

Every request sends a descriptive User-Agent and is rate limited to respect the
Wikimedia, Overpass and FOSSGIS Valhalla usage policies.
"""
import argparse, json, os, sys, time, urllib.parse, urllib.request, math

UA = "TRAILS-hackathon-data-fetch/1.0 (open-source cultural navigation prototype)"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BBOX = (41.872, 12.448, 41.915, 12.502)  # south, west, north, east


def get(url, data=None, timeout=60, raw=False):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
        return body if raw else json.loads(body)


def haversine(a, b):
    R = 6371000
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def wiki(places, out):
    res = {}
    for p in places:
        url = p["sources"][0]["url"]
        title = urllib.parse.unquote(url.rsplit("/wiki/", 1)[1])
        entry = {"title": title, "url": url}
        try:
            s = get("https://en.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(title, safe=""))
            entry.update(status="ok", resolved_title=s.get("title"), qid=s.get("wikibase_item"),
                         description=s.get("description"), extract=s.get("extract"),
                         coordinates=s.get("coordinates"),
                         image=(s.get("originalimage") or {}).get("source"),
                         thumbnail=(s.get("thumbnail") or {}).get("source"))
            c = s.get("coordinates")
            if c:
                entry["offset_m"] = round(haversine((p["lat"], p["lon"]), (c["lat"], c["lon"])))
        except urllib.error.HTTPError as e:
            entry.update(status=f"http_{e.code}")
        except Exception as e:  # network errors are recorded, not fatal
            entry.update(status="error", error=str(e))
        res[p["id"]] = entry
        print(f"[wiki] {p['id']:<34} {entry['status']:<8} offset={entry.get('offset_m')}", flush=True)
        time.sleep(0.2)
    json.dump(res, open(os.path.join(out, "wikipedia.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    return res


def images(places, wikidata, out):
    d = os.path.join(out, "images"); os.makedirs(d, exist_ok=True)
    attrib = {}
    for p in places:
        w = wikidata.get(p["id"], {})
        src = w.get("image")
        if not src:
            continue
        fname = urllib.parse.unquote(src.rsplit("/", 1)[1])
        try:
            q = urllib.parse.urlencode({"action": "query", "format": "json", "prop": "imageinfo",
                                        "titles": "File:" + fname, "iiprop": "url|extmetadata",
                                        "iiurlwidth": 800})
            info = get("https://commons.wikimedia.org/w/api.php?" + q)
            page = next(iter(info["query"]["pages"].values()))
            ii = page["imageinfo"][0]
            meta = ii.get("extmetadata", {})
            lic = (meta.get("LicenseShortName") or {}).get("value", "")
            if not any(k in lic.lower() for k in ("cc", "public domain", "pd")):
                print(f"[img] skip {p['id']}: licence '{lic}'"); continue
            blob = get(ii.get("thumburl") or ii["url"], raw=True)
            open(os.path.join(d, p["id"] + ".jpg"), "wb").write(blob)
            attrib[p["id"]] = {"file": "File:" + fname, "file_page": ii.get("descriptionurl"),
                               "author_html": (meta.get("Artist") or {}).get("value"),
                               "license": lic, "license_url": (meta.get("LicenseUrl") or {}).get("value")}
            print(f"[img] {p['id']:<34} {lic}", flush=True)
        except Exception as e:
            print(f"[img] {p['id']} failed: {e}")
        time.sleep(0.5)
    json.dump(attrib, open(os.path.join(d, "attribution.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)


def overpass(out):
    s, w, n, e = BBOX
    q = f"""[out:json][timeout:180];
way["highway"~"^(footway|pedestrian|path|steps|living_street|residential|service|unclassified|tertiary|secondary|primary|track|cycleway|corridor)$"]
   ["access"!~"^(private|no)$"]["foot"!~"^(no)$"]({s},{w},{n},{e});
(._;>;);
out body;"""
    for ep in ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"):
        try:
            blob = get(ep, data=urllib.parse.urlencode({"data": q}).encode(), timeout=240, raw=True)
            open(os.path.join(out, "osm_walk.json"), "wb").write(blob)
            print(f"[osm] {len(blob)/1e6:.1f} MB from {ep}")
            return
        except Exception as e:
            print(f"[osm] {ep} failed: {e}")


def valhalla(places, out):
    base = "https://valhalla1.openstreetmap.de"
    locs = [{"lat": p["lat"], "lon": p["lon"]} for p in places]
    n = len(locs); chunk = 25
    dur = [[None] * n for _ in range(n)]; dist = [[None] * n for _ in range(n)]
    for i in range(0, n, chunk):
        for j in range(0, n, chunk):
            body = {"sources": locs[i:i + chunk], "targets": locs[j:j + chunk], "costing": "pedestrian", "units": "km"}
            try:
                r = get(base + "/sources_to_targets", data=json.dumps(body).encode(), timeout=60)
                rows = r["sources_to_targets"]
                for a, row in enumerate(rows):
                    for b, cell in enumerate(row):
                        dur[i + a][j + b] = cell.get("time")
                        dist[i + a][j + b] = None if cell.get("distance") is None else round(cell["distance"] * 1000)
                print(f"[valhalla] matrix block {i},{j} ok", flush=True)
            except Exception as e:
                print(f"[valhalla] matrix block {i},{j} failed: {e}")
            time.sleep(1.0)
    json.dump({"ids": [p["id"] for p in places], "duration_s": dur, "distance_m": dist,
               "provider": "valhalla1.openstreetmap.de (FOSSGIS), costing=pedestrian",
               "fetched": time.strftime("%Y-%m-%d")}, open(os.path.join(out, "valhalla_matrix.json"), "w", encoding="utf-8"))
    samples = {}
    by = {p["id"]: p for p in places}
    for a, b in [("pantheon", "colosseum"), ("trevi-fountain", "piazza-navona"), ("castel-sant-angelo", "campo-de-fiori")]:
        body = {"locations": [{"lat": by[a]["lat"], "lon": by[a]["lon"]}, {"lat": by[b]["lat"], "lon": by[b]["lon"]}],
                "costing": "pedestrian", "units": "kilometers", "directions_options": {"language": "en-US"}}
        try:
            samples[f"{a}__{b}"] = get(base + "/route", data=json.dumps(body).encode())
            print(f"[valhalla] route {a} -> {b} ok")
        except Exception as e:
            print(f"[valhalla] route {a} -> {b} failed: {e}")
        time.sleep(1.0)
    json.dump(samples, open(os.path.join(out, "valhalla_samples.json"), "w", encoding="utf-8"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--places", default=os.path.join(ROOT, "data/rome/places.json"))
    ap.add_argument("--out", default=os.path.join(ROOT, "data/open"))
    ap.add_argument("--skip", nargs="*", default=[], choices=["wiki", "images", "osm", "valhalla"])
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    places = json.load(open(a.places, encoding="utf-8"))["places"]
    w = {}
    if "wiki" not in a.skip:
        w = wiki(places, a.out)
    elif os.path.exists(os.path.join(a.out, "wikipedia.json")):
        w = json.load(open(os.path.join(a.out, "wikipedia.json"), encoding="utf-8"))
    if "images" not in a.skip:
        images(places, w, a.out)
    if "osm" not in a.skip:
        overpass(a.out)
    if "valhalla" not in a.skip:
        valhalla(places, a.out)
    print("done ->", a.out)


if __name__ == "__main__":
    sys.exit(main())
