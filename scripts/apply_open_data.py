#!/usr/bin/env python3
"""Merge verified open data (from scripts/fetch_open_data.py) into the TRAILS dataset.

    python3 scripts/apply_open_data.py --open data/open

* Replaces curated coordinates with Wikipedia's coordinates (records the offset).
* Adds the Wikidata QID and marks each source URL as verified (HTTP 200) or not.
* Applies corrected Wikipedia titles from fixed_titles.json when present.
* Copies licensed lead images to public/places/ and writes data/rome/place_images.json.
* Copies the Valhalla pedestrian matrix to public/data/walk_matrix.json.
"""
import argparse, html, json, os, re, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser()
ap.add_argument("--open", default=os.path.join(ROOT, "data", "open"))
a = ap.parse_args()

pf = os.path.join(ROOT, "data", "rome", "places.json")
data = json.load(open(pf, encoding="utf-8"))
wiki = json.load(open(os.path.join(a.open, "wikipedia.json"), encoding="utf-8"))
fixed_path = os.path.join(a.open, "fixed_titles.json")
fixed = json.load(open(fixed_path, encoding="utf-8")) if os.path.exists(fixed_path) else {}
report = {"coords_updated": 0, "verified_sources": 0, "unverified": []}
for p in data["places"]:
    w = wiki.get(p["id"], {})
    if p["id"] in fixed and fixed[p["id"]].get("url"):
        f = fixed[p["id"]]
        p["sources"][0] = {"title": f"{f['title']} — Wikipedia", "url": f["url"]}
        w = {"status": "ok", "coordinates": f.get("coordinates"), "qid": f.get("qid")}
    if w.get("status") == "ok":
        p["sources"][0]["verified"] = True
        report["verified_sources"] += 1
        if w.get("qid"):
            p["wikidata"] = w["qid"]
        c = w.get("coordinates")
        if c:
            p["lat"], p["lon"] = round(c["lat"], 6), round(c["lon"], 6)
            p["coord_source"] = "wikipedia"
            report["coords_updated"] += 1
        else:
            p["coord_source"] = "curated"
    else:
        p["sources"][0]["verified"] = False
        p["coord_source"] = "curated"
        report["unverified"].append(p["id"])
json.dump(data, open(pf, "w", encoding="utf-8"), indent=2, ensure_ascii=False)

img_dir = os.path.join(a.open, "images")
attr_path = os.path.join(img_dir, "attribution.json")
if os.path.exists(attr_path):
    attr = json.load(open(attr_path, encoding="utf-8"))
    os.makedirs(os.path.join(ROOT, "public", "places"), exist_ok=True)
    out = {}
    for pid, m in attr.items():
        src = os.path.join(img_dir, pid + ".jpg")
        if os.path.exists(src):
            shutil.copy(src, os.path.join(ROOT, "public", "places", pid + ".jpg"))
            out[pid] = {**m, "file": f"places/{pid}.jpg",
                       "author": html.unescape(re.sub(r"<[^>]+>", "", m.get("author_html") or "")).strip() or "unknown"}
    json.dump(out, open(os.path.join(ROOT, "data", "rome", "place_images.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    report["lead_images"] = len(out)

mx = os.path.join(a.open, "valhalla_matrix.json")
if os.path.exists(mx):
    os.makedirs(os.path.join(ROOT, "public", "data"), exist_ok=True)
    shutil.copy(mx, os.path.join(ROOT, "public", "data", "walk_matrix.json"))
    report["walk_matrix"] = True
print(json.dumps(report, indent=1))
