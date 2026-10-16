#!/usr/bin/env python3
"""Prepare reference/test photos for TRAILS landmark recognition.

Source: Google Landmarks Dataset v2 (GLDv2, https://github.com/cvdfoundation/google-landmark),
whose images come from Wikimedia Commons under the licences recorded in train_attribution.csv.

Usage:
    python3 scripts/prepare_landmark_images.py --gld-images <dir with <place-id>/<gld-id>.jpg> \
        --attribution train_attribution.csv --out public/landmarks

Each image is resized to <= 480 px and split deterministically into
'reference' (used to build the recognition index) and 'test' (held out for evaluation).
"""
import argparse, csv, hashlib, json, os, sys
from PIL import Image, ImageOps

ap = argparse.ArgumentParser()
ap.add_argument("--gld-images", required=True)
ap.add_argument("--attribution", required=True)
ap.add_argument("--out", default="public/landmarks")
ap.add_argument("--manifest", default="data/rome/landmark_images.json")
ap.add_argument("--test-fraction", type=float, default=0.3)
a = ap.parse_args()

wanted = {}
for pid in sorted(os.listdir(a.gld_images)):
    for f in os.listdir(os.path.join(a.gld_images, pid)):
        if f.endswith(".jpg"):
            wanted[f[:-4]] = pid

attr = {}
csv.field_size_limit(sys.maxsize)
with open(a.attribution, newline="", encoding="utf-8") as fh:
    for row in csv.DictReader(fh):
        if row["id"] in wanted:
            attr[row["id"]] = row

manifest = {"source": "Google Landmarks Dataset v2 (images from Wikimedia Commons)",
            "source_url": "https://github.com/cvdfoundation/google-landmark",
            "note": "Each image keeps its original Wikimedia Commons licence; see per-image author/license.",
            "landmarks": {}}
skipped = 0
for pid in sorted(set(wanted.values())):
    ids = sorted((g for g, p in wanted.items() if p == pid), key=lambda g: hashlib.sha1(g.encode()).hexdigest())
    n_test = max(3, round(len(ids) * a.test_fraction))
    os.makedirs(os.path.join(a.out, pid), exist_ok=True)
    items = []
    for k, g in enumerate(ids):
        meta = attr.get(g)
        lic_ok = meta and meta.get("license", "").upper().replace("-", " ").startswith(("CC BY", "CC0", "PUBLIC DOMAIN"))
        if not lic_ok:
            skipped += 1; continue  # only ship CC BY / CC BY-SA / CC0 / public-domain images
        im = ImageOps.exif_transpose(Image.open(os.path.join(a.gld_images, pid, g + ".jpg"))).convert("RGB")
        im.thumbnail((480, 480))
        im.save(os.path.join(a.out, pid, g + ".jpg"), quality=82)
        lic = meta["license"]
        items.append({"file": f"landmarks/{pid}/{g}.jpg", "gld_id": g,
                      "split": "test" if k < n_test else "reference",
                      "author": meta.get("author", ""), "license": lic.split("(")[0].strip().replace("CC-BY-SA-", "CC BY-SA ").replace("CC-BY-", "CC BY "),
                      "license_url": lic[lic.find("(") + 1:-1] if "(" in lic else None,
                      "commons_page": meta["url"], "title": meta.get("title")})
    manifest["landmarks"][pid] = items
os.makedirs(os.path.dirname(a.manifest), exist_ok=True)
json.dump(manifest, open(a.manifest, "w"), indent=1, ensure_ascii=False)
tot = sum(len(v) for v in manifest["landmarks"].values())
print(f"{len(manifest['landmarks'])} landmarks, {tot} images, skipped {skipped} without licence")
