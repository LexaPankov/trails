#!/usr/bin/env python3
"""Validate the TRAILS Rome dataset (standard library only; uses jsonschema too if installed).

    python3 scripts/validate_dataset.py

Checks: JSON schema, unique ids, near-duplicate places (same normalised name or < 15 m apart),
related-id integrity, bounding box, source URLs, vision/image consistency, image licences.
Exit code 1 on any error.
"""
import json, math, os, re, sys, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
places = json.load(open(os.path.join(ROOT, "data/rome/places.json"), encoding="utf-8"))["places"]
schema = json.load(open(os.path.join(ROOT, "data/schema/place.schema.json"), encoding="utf-8"))
images = json.load(open(os.path.join(ROOT, "data/rome/landmark_images.json"), encoding="utf-8"))
errors, warnings = [], []

try:
    import jsonschema
    v = jsonschema.Draft202012Validator(schema)
    for p in places:
        for e in v.iter_errors(p):
            errors.append(f"{p.get('id')}: schema: {e.message}")
    schema_mode = "jsonschema"
except ImportError:  # minimal fallback checks
    schema_mode = "builtin"
    req = schema["required"]
    for p in places:
        for k in req:
            if k not in p:
                errors.append(f"{p.get('id')}: missing {k}")
        extra = set(p) - set(schema["properties"])
        if extra:
            errors.append(f"{p['id']}: unknown fields {extra}")


def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def dist(a, b):
    k = math.cos(math.radians(a["lat"])) * 111320
    return math.hypot((a["lon"] - b["lon"]) * k, (a["lat"] - b["lat"]) * 110540)


ids = [p["id"] for p in places]
if len(ids) != len(set(ids)):
    errors.append("duplicate ids: " + str({i for i in ids if ids.count(i) > 1}))
names = {}
for p in places:
    n = norm(p["name"])
    if n in names:
        errors.append(f"duplicate name: {p['id']} / {names[n]}")
    names[n] = p["id"]
    if not (41.86 < p["lat"] < 41.92 and 12.44 < p["lon"] < 12.51):
        errors.append(f"{p['id']}: outside central Rome bbox")
    for r in p["related"]:
        if r not in ids:
            errors.append(f"{p['id']}: related id '{r}' does not exist")
        if r == p["id"]:
            errors.append(f"{p['id']}: related to itself")
    for s in p["sources"]:
        if not s["url"].startswith("https://"):
            errors.append(f"{p['id']}: non-https source")
        if s.get("verified") is False:
            warnings.append(f"{p['id']}: source not verified: {s['url']}")
    if (p.get("vision") or {}).get("supported") and p["id"] not in images["landmarks"]:
        errors.append(f"{p['id']}: vision.supported but no reference images")
for i, a in enumerate(places):
    for b in places[i + 1:]:
        if dist(a, b) < 15:
            warnings.append(f"very close places (<15 m): {a['id']} / {b['id']}")
for pid, imgs in images["landmarks"].items():
    if pid not in ids:
        errors.append(f"images for unknown place {pid}")
    for im in imgs:
        if not im["license"].upper().replace("-", " ").startswith(("CC BY", "CC0", "PUBLIC DOMAIN")):
            errors.append(f"{im['file']}: licence {im['license']} not allowed")
        if not os.path.exists(os.path.join(ROOT, "public", im["file"])):
            errors.append(f"missing image file {im['file']}")
    if not any(i["split"] == "reference" for i in imgs) or not any(i["split"] == "test" for i in imgs):
        errors.append(f"{pid}: needs both reference and test images")

print(f"{len(places)} places, {sum(len(v) for v in images['landmarks'].values())} landmark images, schema check: {schema_mode}")
for w in warnings:
    print("WARN ", w)
for e in errors:
    print("ERROR", e)
print("OK" if not errors else f"{len(errors)} error(s)")
sys.exit(1 if errors else 0)
