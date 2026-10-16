"""Feature encoding for the TRAILS preference model (schema trails-pref-v1).

Mirrors src/lib/model/features.ts exactly; tests/parity checks both sides.
"""
import json
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA = json.load(open(os.path.join(HERE, "feature_schema.json")))
INTERESTS = SCHEMA["interests"]
PERIODS = SCHEMA["periods"]
THEMES = SCHEMA["themes"]
N_USER = 2 * len(INTERESTS)
N_PLACE = len(PERIODS) + len(THEMES) + 3
assert N_USER + N_PLACE == SCHEMA["input_size"]


def place_vector(p):
    v = np.zeros(N_PLACE, dtype=np.float32)
    for i, per in enumerate(PERIODS):
        v[i] = 1.0 if per in p["periods"] else 0.0
    o = len(PERIODS)
    for i, th in enumerate(THEMES):
        v[o + i] = 1.0 if th in p["themes"] else 0.0
    o += len(THEMES)
    v[o] = 1.0 if p.get("kind") == "hidden_gem" else 0.0
    v[o + 1] = (float(p.get("significance", 3)) - 1.0) / 4.0
    v[o + 2] = min(float(p.get("visit_minutes", 15)), 60.0) / 60.0
    return v


def place_axes(p):
    """How strongly a place expresses each interest axis (0/1), used for affinity updates."""
    return np.array([
        1.0 if "ancient" in p["periods"] else 0.0,
        1.0 if "medieval" in p["periods"] else 0.0,
        1.0 if "renaissance" in p["periods"] else 0.0,
        1.0 if "baroque" in p["periods"] else 0.0,
        1.0 if "modern" in p["periods"] else 0.0,
        1.0 if "archaeology" in p["themes"] else 0.0,
        1.0 if ("art" in p["themes"] or "architecture" in p["themes"]) else 0.0,
        1.0 if p.get("kind") == "hidden_gem" else 0.0,
    ], dtype=np.float32)


def user_vector(interests, affinity):
    v = np.zeros(N_USER, dtype=np.float32)
    for i, k in enumerate(INTERESTS):
        v[i] = 1.0 if k in interests else 0.0
        v[len(INTERESTS) + i] = float(np.clip(affinity.get(k, 0.0), -1, 1))
    return v


def load_places(path=None):
    path = path or os.path.join(HERE, "..", "data", "rome", "places.json")
    return json.load(open(path))["places"]
