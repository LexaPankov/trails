"""Explainable preference-affinity update rule (mirrored in src/lib/profile.ts).

affinity[k] <- clip(affinity[k] + w(signal) * axes[k] / sqrt(max(1, sum(axes))), -1, 1)

A place that expresses several interest axes spreads its signal across them. Skips are
deliberately weak: a skipped stop may just mean the user was short of time.
"""
import numpy as np

from features import INTERESTS

SIGNAL_WEIGHTS = {
    "like": 0.35,
    "save": 0.25,
    "visited": 0.20,
    "open_details": 0.08,
    "skip": -0.04,
    "dislike": -0.35,
}


def apply_signal(aff, axes, signal):
    w = SIGNAL_WEIGHTS[signal]
    norm = np.sqrt(max(float(np.sum(axes)), 1.0))
    out = dict(aff)
    for i, k in enumerate(INTERESTS):
        out[k] = float(np.clip(out.get(k, 0.0) + w * axes[i] / norm, -1.0, 1.0))
    return out
