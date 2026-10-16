"""Generate SYNTHETIC user-place interaction data for bootstrapping the TRAILS preference model.

There is no real user feedback yet, so we simulate users. Every row in the output is
synthetic and is labelled as such; metrics computed on it measure how well the network
recovers the simulator's preference structure, NOT real-world recommendation quality.

Simulator (documented so it can be challenged):
  * Each user has a latent taste vector over the 8 interest axes. Users *select* the
    interests whose latent taste is clearly positive, but they also forget some and
    over-select others (selection noise), so explicit interests are an imperfect signal.
  * Some users have an interaction history. It is simulated with the same affinity
    update rule the app uses (ml/affinity.py, mirrored in src/lib/profile.ts), driven by
    the user's latent taste, so affinity carries extra information about hidden taste.
  * True relevance of a place = latent taste . place axes (normalised), plus a mild
    popularity effect, a dislike of very long visits for low-engagement users, and an
    interaction term: hidden-gem lovers are less excited by headline sights.
  * Label = Bernoulli(sigmoid(relevance)) - e.g. "user liked / saved this stop".
  * Places: the 74 curated Rome places plus randomly generated synthetic places so the
    model has to learn from attributes rather than memorise place identities.
"""
import argparse
import json
import os

import numpy as np

from affinity import apply_signal
from features import INTERESTS, PERIODS, THEMES, load_places, place_axes, place_vector, user_vector

HERE = os.path.dirname(os.path.abspath(__file__))


def synthetic_place(rng, i):
    periods = [p for p in PERIODS if rng.random() < 0.28] or [PERIODS[rng.integers(len(PERIODS))]]
    themes = [t for t in THEMES if rng.random() < 0.35] or [THEMES[rng.integers(len(THEMES))]]
    sig = int(rng.integers(1, 6))
    kind = "hidden_gem" if (sig <= 3 and rng.random() < 0.5) else ("major" if sig >= 4 else "notable")
    return {"id": f"synthetic-{i}", "periods": periods, "themes": themes, "significance": sig,
            "kind": kind, "visit_minutes": int(rng.choice([4, 6, 8, 10, 15, 20, 30, 45, 60]))}


def relevance(taste, engagement, p):
    ax = place_axes(p)
    match = float(taste @ ax) / np.sqrt(max(ax.sum(), 1.0))
    sig = (p["significance"] - 1) / 4
    z = 2.2 * match + 0.8 * sig - 0.9
    if p["kind"] == "major":
        z -= 0.9 * max(taste[INTERESTS.index("hidden_gems")], 0)
    if p["visit_minutes"] >= 30:
        z -= 0.8 * (1 - engagement)
    return z


def make_user(rng):
    taste = rng.normal(0, 0.8, len(INTERESTS))
    # a few strong passions per user
    for k in rng.choice(len(INTERESTS), size=rng.integers(1, 4), replace=False):
        taste[k] += rng.uniform(0.8, 1.6)
    taste = np.clip(taste, -1.5, 2.0)
    selected = [INTERESTS[k] for k in range(len(INTERESTS))
                if (taste[k] > 0.6 and rng.random() > 0.2) or (taste[k] <= 0.6 and rng.random() < 0.08)]
    engagement = rng.uniform(0, 1)
    return taste, selected, engagement


def simulate_history(rng, taste, engagement, places):
    aff = {k: 0.0 for k in INTERESTS}
    if rng.random() < 0.4:  # 40 % of users are brand new
        return aff
    for _ in range(int(rng.integers(3, 30))):
        p = places[rng.integers(len(places))]
        prob = 1 / (1 + np.exp(-relevance(taste, engagement, p)))
        u = rng.random()
        if u < prob * 0.5:
            sig = rng.choice(["like", "save", "visited", "open_details"])
        elif u < prob:
            sig = "open_details"
        elif rng.random() < 0.3:
            sig = "dislike"
        else:
            sig = "skip"
        aff = apply_signal(aff, place_axes(p), sig)
    return aff


def generate(n_users, pairs_per_user, seed, n_synth_places):
    rng = np.random.default_rng(seed)
    real = load_places()
    synth = [synthetic_place(rng, i) for i in range(n_synth_places)]
    pool = real + synth
    X, y, P, U, R = [], [], [], [], []
    for u in range(n_users):
        taste, selected, engagement = make_user(rng)
        aff = simulate_history(rng, taste, engagement, pool)
        uv = user_vector(selected, aff)
        for j in rng.choice(len(pool), size=pairs_per_user, replace=False):
            p = pool[j]
            z = relevance(taste, engagement, p)
            prob = 1 / (1 + np.exp(-z))
            X.append(np.concatenate([uv, place_vector(p)]))
            y.append(float(rng.random() < prob))
            P.append(prob); U.append(u); R.append(1 if j < len(real) else 0)
    return (np.array(X, np.float32), np.array(y, np.float32), np.array(P, np.float32),
            np.array(U, np.int32), np.array(R, np.int8))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--users", type=int, default=6000)
    ap.add_argument("--pairs", type=int, default=40)
    ap.add_argument("--synthetic-places", type=int, default=400)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", default=os.path.join(HERE, "data", "synthetic_interactions.npz"))
    a = ap.parse_args()
    X, y, P, U, R = generate(a.users, a.pairs, a.seed, a.synthetic_places)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    np.savez_compressed(a.out, X=X, y=y, true_prob=P, user=U, real_place=R,
                        meta=json.dumps({"synthetic": True, "seed": a.seed, "users": a.users,
                                         "pairs_per_user": a.pairs, "synthetic_places": a.synthetic_places}))
    print(f"SYNTHETIC dataset: {len(y)} rows, {a.users} simulated users, positive rate {y.mean():.3f} -> {a.out}")


if __name__ == "__main__":
    main()
