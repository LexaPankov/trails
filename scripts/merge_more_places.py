#!/usr/bin/env python3
"""Grow the TRAILS dataset with places imported from Wikidata + Wikipedia (output of fetch_more_places.py).

    python3 scripts/merge_more_places.py --open data/open [--max 400] [--dry-run]

Rules (deterministic, no invented facts):
* Only items whose Wikidata classes match a cultural type, with a Wikipedia summary that loaded (HTTP 200).
* Periods come from Wikidata inception (P571) and/or architectural style (P149). Without either, from a
  Wikidata class that only exists in antiquity (Roman temple, thermae...), else from the first century or
  style word in the Wikipedia short description + first sentence. Recorded in period_source. No period -> not imported.
* Themes come from the Wikidata classes. Significance and kind come from the number of Wikipedia/Wikimedia
  language editions (sitelinks), a popularity proxy, and are labelled as such in the dataset notes.
* Summary = first sentences of the Wikipedia lead (CC BY-SA, linked as the source); history = the rest of the lead.
* Little-known items (< 12 sitelinks) that Wikipedia defines in the past tense ("X was a temple...") are
  skipped: they are usually demolished or never located, so there is nothing to see on a walk.
* Curated places always win: an item is skipped if its QID is already in the dataset, or if it is within 30 m
  of a curated place (15 m of an earlier, more-linked import).
* Every imported record carries origin="wikidata" so the app can say it was not reviewed by hand.
"""
import argparse, html, json, math, os, re, shutil, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

EXCLUDE = ("hotel", "embassy", "school", "hospital", "station", "university", "company", "business", "neighbourhood",
           "neighborhood", "quarter", "district", "human settlement", "restaurant", "café", "cafe", "shop",
           "store", "office", "ministry", "government", "court", "parliament", "bank", "headquarters", "apartment",
           "residential", "parking", "stadium", "sports", "cinema", "nightclub", "hostel", "consulate", "organization",
           "organisation", "institute", "academy", "faculty", "seminary", "diocese",
           "railway", "metro", "bus", "tram", "road", "highway", "lungotevere", "hill", "river", "island", "fictional",
           "event", "painting", "fresco", "tapestry", "manuscript", "family")
EXCLUDE_QIDS = {
    "Q741051": "Catacombs of Rome: an article about all the catacombs; its point is a church in Monti",
}
THEME_RULES = [
    ("religion", ("church", "basilica", "chapel", "oratory", "cathedral", "temple", "convent", "monastery", "cloister",
                  "synagogue", "cemetery", "catacomb", "tomb", "mausoleum", "mithraeum", "shrine")),
    ("archaeology", ("archaeological", "ruin", "forum", "bath", "circus", "amphitheatre", "insula", "domus", "mithraeum",
                     "aqueduct", "catacomb", "ancient roman", "roman temple", "roman villa")),
    ("art", ("museum", "gallery", "fountain", "statue", "sculpture", "obelisk", "column", "monument", "memorial")),
    ("architecture", ("palace", "palazzo", "villa", "building", "house", "tower", "bridge", "gate", "arch", "wall",
                      "staircase", "steps", "church", "basilica", "theatre", "theater", "castle", "fortification",
                      "portico", "library")),
    ("civic", ("square", "piazza", "street", "monument", "memorial", "library", "college", "theatre", "theater",
               "market", "garden", "park", "bridge", "gate")),
]
CULTURAL = tuple(sorted({k for _, ks in THEME_RULES for k in ks}))
STYLE_PERIOD = [
    ("ancient", ("ancient roman", "roman architecture", "roman imperial", "classical architecture")),
    ("medieval", ("romanesque", "gothic", "cosmatesque", "byzantine", "early christian", "medieval", "paleochristian")),
    ("renaissance", ("renaissance", "mannerism", "mannerist")),
    ("baroque", ("baroque", "rococo", "barocchetto")),
    ("modern", ("neoclassical", "neoclassicism", "art nouveau", "liberty style", "eclecticism", "fascist", "rationalism",
                "rationalist", "modernism", "modern architecture", "neo-renaissance", "neo-baroque", "neo-gothic",
                "historicism", "umbertino", "novecento")),
]
# Fallbacks when Wikidata has neither inception nor style (see period_fallback):
# 1. Wikidata classes that only exist in antiquity.
CLASS_ANCIENT = ("ancient roman", "roman temple", "roman bridge", "roman villa", "roman theatre", "roman road",
                 "roman aqueduct", "roman tomb", "roman forum", "thermae", "domus", "insula", "mithraeum", "curia",
                 "rostra", "forum venalium", "triumphal arch")
# 2. The Wikipedia short description and first sentence ("17th-century Baroque church in Rome").
TEXT_PERIOD = [
    ("modern", r"\bneo-?(?:classical|renaissance|baroque|gothic|romanesque)\b|\bneoclassic|\bart nouveau\b|\bfascist\b|\brationalist\b|\bmodernist\b"),
    # "an ancient church" means old, not Roman antiquity
    ("ancient", r"\bancient\b(?!\s+(?:catholic\s+|roman catholic\s+)?(?:church|basilica|chapel|titular|parish|oratory))|\broman[- ]era\b|\b(?:imperial|republican) roman\b|\bcentury bc\b|\bbc\b"),
    ("medieval", r"\bmedieval\b|\bromanesque\b|\bgothic\b|\bearly christian\b|\bpaleochristian\b|\bbyzantine\b"),
    ("renaissance", r"\brenaissance\b|\bmannerist\b"),
    ("baroque", r"\bbaroque\b|\brococo\b"),
]
CENTURY = re.compile(r"\b(\d{1,2})(?:st|nd|rd|th)[- ]century(?:\s+(bc))?", re.I)


def period_from_century(c, bc):
    return ("ancient" if bc or c <= 5 else "medieval" if c <= 14 else "renaissance" if c <= 16
            else "baroque" if c <= 18 else "modern")


def period_fallback(classes, w):
    """Period for an item with no Wikidata inception/style, or (None, None). Returns (period, source)."""
    if any(k in c for c in classes for k in CLASS_ANCIENT):
        return "ancient", "wikidata class"
    first = sentences((w or {}).get("extract"))[:1]
    text = " ".join([(w or {}).get("description") or ""] + first).lower()
    hits = [(m.start(), period_from_century(int(m.group(1)), m.group(2))) for m in CENTURY.finditer(text)]
    for per, rx in TEXT_PERIOD:
        hits += [(m.start(), per) for m in re.finditer(rx, text)]
    if not hits:
        return None, None
    return min(hits)[1], "wikipedia description"  # the first period-word in the text wins


CATEGORY_ORDER = ("basilica", "church", "chapel", "temple", "palace", "palazzo", "villa", "fountain", "obelisk", "column",
                  "statue", "monument", "memorial", "museum", "gallery", "archaeological", "ruin", "tomb", "mausoleum",
                  "bridge", "gate", "arch", "square", "piazza", "street", "theatre", "library", "garden", "tower", "building")


def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def slug(s):
    return re.sub(r"\s+", "-", norm(s))[:60].strip("-") or "place"


def dist(a, b):
    k = math.cos(math.radians(a["lat"])) * 111320
    return math.hypot((a["lon"] - b["lon"]) * k, (a["lat"] - b["lat"]) * 110540)


def year_of(inception):
    """Wikidata time string like '+1650-00-00T00:00:00Z' or '-0027-01-01T00:00:00Z' -> int year, or None."""
    m = re.match(r"^([+-]?)0*(\d{1,4})-", inception or "")
    if not m:
        return None
    y = int(m.group(2))
    return -y if m.group(1) == "-" else y


def period_of_year(y):
    if y is None:
        return None
    return "ancient" if y < 500 else "medieval" if y < 1400 else "renaissance" if y < 1580 else "baroque" if y < 1750 else "modern"


def built_text(y):
    if y is None:
        return None
    return f"{-y} BC" if y < 0 else f"{y} AD" if y < 1000 else str(y)


def sentences(text):
    return [x for x in re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"“(])", (text or "").strip()) if x]


def defined_in_past(extract):
    """Wikipedia defines lost buildings in the past tense: "The Villa publica was a public building..."."""
    v = re.search(r"\b(is|are|was|were)\b", (sentences(extract) or [""])[0])
    return bool(v) and v.group(1) in ("was", "were")


def copy_photo(src, dst, max_px=720, quality=80):
    """Copy a lead photo into the app, downsized and re-encoded when Pillow is available (~3x smaller)."""
    try:
        from PIL import Image, ImageOps
    except ImportError:
        shutil.copy(src, dst)
        return
    im = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
    im.thumbnail((max_px, max_px))
    im.save(dst, "JPEG", quality=quality, optimize=True, progressive=True)


def classify(it, w=None):
    classes = [c.lower() for c in it.get("classes", [])]
    if not classes or any(x in c for c in classes for x in EXCLUDE):
        return None
    if not any(k in c for c in classes for k in CULTURAL):
        return None
    themes = [t for t, ks in THEME_RULES if any(k in c for c in classes for k in ks)]
    styles = [s.lower() for s in it.get("styles", [])]
    y = year_of(it.get("inception"))
    periods = []
    p = period_of_year(y)
    if p:
        periods.append(p)
    for per, ks in STYLE_PERIOD:
        if any(k in s for s in styles for k in ks) and per not in periods:
            periods.append(per)
    source = "wikidata"
    if not periods:
        per, source = period_fallback(classes, w)
        periods = [per] if per else []
    if not periods or not themes:
        return None
    category = next((k for k in CATEGORY_ORDER if any(k in c for c in classes)), classes[0])
    category = {"palazzo": "palace", "piazza": "square", "archaeological": "ruin", "memorial": "monument"}.get(category, category)
    return themes, periods, y, category, source


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--open", default=os.path.join(ROOT, "data", "open"))
    ap.add_argument("--max", type=int, default=400)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    pf = os.path.join(ROOT, "data", "rome", "places.json")
    data = json.load(open(pf, encoding="utf-8"))
    places = [p for p in data["places"] if p.get("origin") != "wikidata"]  # re-runnable: drop earlier imports
    curated = list(places)
    have_q = {p.get("wikidata") for p in curated}
    have_ids = {p["id"] for p in curated}
    have_names = {norm(p["name"]) for p in curated}
    cands = json.load(open(os.path.join(a.open, "wikidata_candidates.json"), encoding="utf-8"))
    wk = json.load(open(os.path.join(a.open, "more_wikipedia.json"), encoding="utf-8"))
    s_, w_, n_, e_ = 41.872, 12.448, 41.915, 12.502
    report = {"candidates": len(cands), "imported": 0, "skipped": {}}

    def skip(reason):
        report["skipped"][reason] = report["skipped"].get(reason, 0) + 1

    added = []
    for it in cands:  # most-linked first
        if it["qid"] in EXCLUDE_QIDS:
            skip("excluded by hand (see EXCLUDE_QIDS)"); continue
        if len(added) >= a.max:
            break
        w = wk.get(it["qid"])
        if not w or w.get("status") != "ok" or w.get("type") == "disambiguation":
            skip("no Wikipedia summary"); continue
        if it["qid"] in have_q:
            skip("already curated"); continue
        c = classify(it, w)
        if not c:
            skip("not a dated cultural place"); continue
        themes, periods, y, category, period_source = c
        coord = w.get("coordinates") or {"lat": it["lat"], "lon": it["lon"]}
        pt = {"lat": round(coord["lat"], 6), "lon": round(coord["lon"], 6)}
        if not (s_ <= pt["lat"] <= n_ and w_ <= pt["lon"] <= e_):
            skip("outside the TRAILS area"); continue
        if it["sitelinks"] < 12 and defined_in_past(w.get("extract")):
            skip("little-known and described in the past tense (probably nothing left to see)"); continue
        name = re.sub(r"\s*(,\s*Rome|\(Rome\))$", "", w.get("resolved_title") or it["label"]).strip()
        # 30 m from a hand-placed curated pin; 15 m between imports (central Rome is dense: a church above
        # a temple or a fountain at an aqueduct's end are 20 m apart; two articles on one structure are ~0 m)
        if norm(name) in have_names or any(dist(pt, q) < 30 for q in curated) or any(dist(pt, q) < 15 for q in added):
            skip("duplicate or too close to another place"); continue
        sents = sentences(w.get("extract"))
        summary, rest = "", []
        for i, snt in enumerate(sents):
            if len(summary) + len(snt) > 330 and summary:
                rest = sents[i:]; break
            summary = (summary + " " + snt).strip()
        if len(summary) < 40:
            skip("Wikipedia lead too short"); continue
        if len(summary) > 400:
            summary = summary[:397].rsplit(" ", 1)[0] + "…"
        sl = it["sitelinks"]
        kind = "major" if sl >= 40 else "notable" if sl >= 12 else "hidden_gem"
        significance = 5 if sl >= 60 else 4 if sl >= 30 else 3 if sl >= 15 else 2 if sl >= 7 else 1
        visit = {"major": 15, "notable": 8, "hidden_gem": 5}[kind]
        if category in ("museum", "gallery"):
            visit = 45 if kind == "major" else 30
        pid = slug(name)
        while pid in have_ids:
            pid += "-" + it["qid"].lower()
        rec = {
            "id": pid, "name": name, "lat": pt["lat"], "lon": pt["lon"], "periods": periods, "themes": themes,
            "significance": significance, "kind": kind, "category": category,
            "summary": summary, "visit_minutes": visit, "related": [],
            "sources": [{"title": f"{name} — Wikipedia", "url": w["url"], "verified": True},
                        {"title": f"{it['qid']} — Wikidata", "url": f"https://www.wikidata.org/wiki/{it['qid']}", "verified": True}],
            "wikidata": it["qid"], "coord_source": "wikipedia" if w.get("coordinates") else "wikidata", "origin": "wikidata",
            "period_source": period_source,
        }
        if y is not None:
            rec["built"] = built_text(y)
        hist = " ".join(rest).strip()
        if hist:
            rec["history"] = hist[:700].rsplit(" ", 1)[0] + ("…" if len(hist) > 700 else "")
        added.append(rec); have_ids.add(pid); have_names.add(norm(name))
    report["imported"] = len(added)

    if a.dry_run:
        print(json.dumps(report, indent=1)); print(json.dumps(added[:3], indent=1, ensure_ascii=False)); return
    data["places"] = curated + added
    data["notes"] = re.sub(r"\s*Imported places:.*$", "", data["notes"]) + (
        " Imported places: records with origin='wikidata' were added automatically by scripts/merge_more_places.py "
        "from Wikidata (classes, inception, style, coordinates) and the Wikipedia lead (summary, history, CC BY-SA); "
        "their significance and kind come from Wikimedia sitelink counts, a popularity proxy, and they were not "
        "reviewed by hand.")
    json.dump(data, open(pf, "w", encoding="utf-8"), indent=2, ensure_ascii=False)

    # licensed lead images for imported places
    img_dir = os.path.join(a.open, "more_images")
    attr_path = os.path.join(img_dir, "attribution.json")
    ip = os.path.join(ROOT, "data", "rome", "place_images.json")
    imgs = json.load(open(ip, encoding="utf-8")) if os.path.exists(ip) else {}
    imgs = {k: v for k, v in imgs.items() if k in {p["id"] for p in data["places"]}}
    if os.path.exists(attr_path):
        attr = json.load(open(attr_path, encoding="utf-8"))
        for rec in added:
            m = attr.get(rec["wikidata"])
            src = os.path.join(img_dir, rec["wikidata"] + ".jpg")
            if not m or not os.path.exists(src):
                continue
            copy_photo(src, os.path.join(ROOT, "public", "places", rec["id"] + ".jpg"))
            imgs[rec["id"]] = {**m, "file": f"places/{rec['id']}.jpg",
                               "author": html.unescape(re.sub(r"<[^>]+>", "", m.get("author_html") or "")).strip() or "unknown"}
    json.dump(imgs, open(ip, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    report["images_total"] = len(imgs)
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
