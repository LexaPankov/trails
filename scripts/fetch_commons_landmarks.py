#!/usr/bin/env python3
"""Add camera-recognition photos for more landmarks from Wikimedia Commons (needs internet).

Step 1, fetch candidates (photos stay outside the app until reviewed):
    python3 scripts/fetch_commons_landmarks.py fetch colosseum pantheon --out data/open/commons_landmarks
  For each place: its Commons category (Wikidata P373), JPEG files directly in that category, freely
  licensed only (CC BY, CC BY-SA, CC0, public domain), no interiors/plans/drawings by title, 800 px wide.
  Writes <out>/<place>/<n>.jpg, <out>/candidates.json and <out>/<place>_sheet.jpg (numbered contact sheet).
  If the main category is mostly details or interiors, name a better one:
    --category colosseum="Exterior of the Colosseum"

Step 2, look at the contact sheets, list the photos that clearly show the landmark from outside, then:
    python3 scripts/fetch_commons_landmarks.py apply --out data/open/commons_landmarks --keep keep.json
  keep.json = {"colosseum": [0, 2, 3, ...], ...}. Every third kept photo (by file hash) becomes a held-out
  test photo, the rest reference photos. Copies them to public/landmarks/<place>/, adds them to
  data/rome/landmark_images.json with author and licence, and marks the place vision.supported.
  Then rebuild the index: npm run dev, node scripts/vision_eval.mjs

Standard library only, except Pillow for resizing and contact sheets. Polite User-Agent, rate limited.
"""
import argparse, hashlib, html, io, json, os, re, shutil, sys, time, urllib.parse, urllib.request

from PIL import Image, ImageDraw, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = "TRAILS-hackathon-data-fetch/1.2 (https://github.com/LexaPankov/trails; open-source cultural navigation prototype)"
API = "https://commons.wikimedia.org/w/api.php"
ALLOWED = ("CC BY", "CC0", "PUBLIC DOMAIN", "PD")
SKIP_TITLE = ("interior", "inside", "plan", "map", "drawing", "engraving", "painting", "print", "stamp", "coin",
              "model", "relief", "inscription", "detail", "ceiling", "floor", "dome from below", "underground",
              "hypogeum", "night", "nacht", "notte", "aerial", "panorama", "lego", "replica")


def get(url, raw=False, tries=5):
    for n in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read()
                return body if raw else json.loads(body)
        except urllib.error.HTTPError as err:
            if err.code not in (429, 503) or n == tries - 1:
                raise
            wait = min(int(err.headers.get("Retry-After") or 0) or 5 * 2 ** n, 120)
            print(f"[wait] {err.code}, retrying in {wait} s", flush=True)
            time.sleep(wait)


def api(**params):
    return get(API + "?" + urllib.parse.urlencode({"format": "json", "formatversion": 2, **params}))


def commons_category(qid):
    r = get("https://www.wikidata.org/w/api.php?" + urllib.parse.urlencode(
        {"action": "wbgetclaims", "entity": qid, "property": "P373", "format": "json"}))
    claims = r.get("claims", {}).get("P373", [])
    return claims[0]["mainsnak"]["datavalue"]["value"] if claims else None


def plain(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()


def fetch(a):
    places = {p["id"]: p for p in json.load(open(os.path.join(ROOT, "data/rome/places.json"), encoding="utf-8"))["places"]}
    os.makedirs(a.out, exist_ok=True)
    cpath = os.path.join(a.out, "candidates.json")
    cands = json.load(open(cpath, encoding="utf-8")) if os.path.exists(cpath) else {}
    override = dict(c.split("=", 1) for c in a.category)
    for pid in a.places:
        p = places[pid]
        cat = override.get(pid) or commons_category(p["wikidata"])
        print(f"[{pid}] Commons category: {cat}", flush=True)
        files, cont = [], {}
        while len(files) < 400:
            r = api(action="query", list="categorymembers", cmtitle=f"Category:{cat}", cmtype="file", cmlimit=200, **cont)
            files += [m["title"] for m in r["query"]["categorymembers"]]
            if "continue" not in r:
                break
            cont = r["continue"]
        files = [f for f in files if f.lower().endswith((".jpg", ".jpeg")) and not any(k in f.lower() for k in SKIP_TITLE)]
        kept = []
        for i in range(0, len(files), 40):
            r = api(action="query", prop="imageinfo", titles="|".join(files[i:i + 40]),
                    iiprop="url|size|extmetadata", iiurlwidth=800)
            for page in r["query"]["pages"]:
                ii = (page.get("imageinfo") or [{}])[0]
                md = ii.get("extmetadata", {})
                lic = plain(md.get("LicenseShortName", {}).get("value")).upper().replace("-", " ")
                if not lic.startswith(ALLOWED) or ii.get("width", 0) < 800:
                    continue
                kept.append({"title": page["title"], "thumb": ii["thumburl"], "commons_page": ii["descriptionurl"],
                             "license": plain(md["LicenseShortName"]["value"]),
                             "license_url": plain(md.get("LicenseUrl", {}).get("value")) or None,
                             "author": plain(md.get("Artist", {}).get("value"))[:200] or "unknown"})
            time.sleep(0.5)
        # spread the picks over the (alphabetical) list instead of taking the first N
        step = max(1, len(kept) // a.per_place)
        picks = kept[::step][:a.per_place]
        d = os.path.join(a.out, pid)
        os.makedirs(d, exist_ok=True)
        for n, c in enumerate(picks):
            im = ImageOps.exif_transpose(Image.open(io.BytesIO(get(c["thumb"], raw=True)))).convert("RGB")
            im.thumbnail((800, 800))
            im.save(os.path.join(d, f"{n}.jpg"), quality=88)
            time.sleep(0.4)
        cands[pid] = picks
        sheet(d, len(picks), os.path.join(a.out, f"{pid}_sheet.jpg"))
        print(f"[{pid}] {len(files)} files, {len(kept)} freely licensed, {len(picks)} downloaded", flush=True)
        json.dump(cands, open(cpath, "w", encoding="utf-8"), indent=1, ensure_ascii=False)


def sheet(d, n, path, cell=260, cols=6):
    rows = (n + cols - 1) // cols
    out = Image.new("RGB", (cols * cell, max(rows, 1) * cell), "white")
    draw = ImageDraw.Draw(out)
    for i in range(n):
        im = Image.open(os.path.join(d, f"{i}.jpg"))
        im.thumbnail((cell - 8, cell - 8))
        x, y = (i % cols) * cell + 4, (i // cols) * cell + 4
        out.paste(im, (x, y))
        draw.rectangle([x, y, x + 34, y + 22], fill="black")
        draw.text((x + 6, y + 5), str(i), fill="yellow")
    out.save(path, quality=85)


def apply(a):
    keep = json.load(open(a.keep, encoding="utf-8"))
    cands = json.load(open(os.path.join(a.out, "candidates.json"), encoding="utf-8"))
    ip = os.path.join(ROOT, "data/rome/landmark_images.json")
    images = json.load(open(ip, encoding="utf-8"))
    pf = os.path.join(ROOT, "data/rome/places.json")
    data = json.load(open(pf, encoding="utf-8"))
    for pid, idx in keep.items():
        entries = []
        for n in idx:
            c = cands[pid][n]
            src = os.path.join(a.out, pid, f"{n}.jpg")
            h = hashlib.sha1(open(src, "rb").read()).hexdigest()[:16]
            entries.append((h, src, c))
        entries.sort()
        rows = []
        os.makedirs(os.path.join(ROOT, "public/landmarks", pid), exist_ok=True)
        for k, (h, src, c) in enumerate(entries):
            rel = f"landmarks/{pid}/{h}.jpg"
            shutil.copy(src, os.path.join(ROOT, "public", rel))
            rows.append({"file": rel, "split": "test" if k % 3 == 2 else "reference", "author": c["author"],
                         "license": c["license"], "license_url": c["license_url"], "commons_page": c["commons_page"],
                         "title": c["title"], "source": "Wikimedia Commons category (TRAILS, hand-checked)"})
        images["landmarks"][pid] = rows
        for p in data["places"]:
            if p["id"] == pid:
                p["vision"] = {"supported": True}
        print(f"[{pid}] {sum(r['split'] == 'reference' for r in rows)} reference, {sum(r['split'] == 'test' for r in rows)} test")
    json.dump(images, open(ip, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    json.dump(data, open(pf, "w", encoding="utf-8"), indent=2, ensure_ascii=False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["fetch", "apply"])
    ap.add_argument("places", nargs="*")
    ap.add_argument("--out", default=os.path.join(ROOT, "data/open/commons_landmarks"))
    ap.add_argument("--per-place", type=int, default=30)
    ap.add_argument("--keep")
    ap.add_argument("--category", action="append", default=[],
                    help='use this Commons category instead of the Wikidata one, e.g. colosseum="Exterior of the Colosseum"')
    a = ap.parse_args()
    fetch(a) if a.cmd == "fetch" else apply(a)


if __name__ == "__main__":
    sys.exit(main())
