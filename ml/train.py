"""Train the TRAILS preference MLP with PyTorch on AMD ROCm GPUs when available, else CPU.

    python ml/generate_data.py          # synthetic bootstrap data (clearly labelled)
    python ml/train.py                  # trains, evaluates, exports

Outputs:
    ml/artifacts/preference_mlp.pt      PyTorch state dict
    ml/artifacts/preference_mlp.onnx    ONNX export (opset 17)
    ml/artifacts/metrics.json           held-out evaluation + device actually used
    public/models/preference_mlp.json   weights consumed by the web app's TS inference
    tests/fixtures/model_parity.json    inputs/outputs for the TS parity test
"""
import argparse
import json
import os
import platform
import time

import numpy as np
import torch
from torch import nn

from features import INTERESTS, N_PLACE, N_USER, SCHEMA

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


class PreferenceMLP(nn.Module):
    def __init__(self, n_in=N_USER + N_PLACE, h1=32, h2=16):
        super().__init__()
        self.net = nn.Sequential(nn.Linear(n_in, h1), nn.ReLU(), nn.Linear(h1, h2), nn.ReLU(), nn.Linear(h2, 1))

    def forward(self, x):  # returns logits
        return self.net(x).squeeze(-1)


def pick_device(pref):
    info = {"torch": torch.__version__, "hip": getattr(torch.version, "hip", None),
            "cuda": torch.version.cuda, "python": platform.python_version(), "machine": platform.machine()}
    gpu = torch.cuda.is_available()  # ROCm builds expose AMD GPUs through the torch.cuda API
    if pref == "cpu" or (pref == "auto" and not gpu):
        dev = torch.device("cpu")
        info["device"] = "cpu"
        info["device_name"] = platform.processor() or platform.machine()
        info["backend"] = "CPU"
    else:
        if not gpu:
            raise SystemExit("--device gpu requested but torch.cuda.is_available() is False")
        dev = torch.device("cuda")
        info["device"] = "cuda"
        info["device_name"] = torch.cuda.get_device_name(0)
        info["backend"] = f"ROCm/HIP {torch.version.hip}" if torch.version.hip else f"CUDA {torch.version.cuda} (not AMD)"
    return dev, info


def auc(y, s):
    order = np.argsort(s, kind="mergesort")
    ranks = np.empty(len(s)); ranks[order] = np.arange(1, len(s) + 1)
    # average ranks for ties
    _, inv, cnt = np.unique(s, return_inverse=True, return_counts=True)
    sums = np.bincount(inv, weights=ranks); ranks = (sums / cnt)[inv]
    pos = y == 1; n1, n0 = pos.sum(), (~pos).sum()
    return float((ranks[pos].sum() - n1 * (n1 + 1) / 2) / (n1 * n0))


def logloss(y, p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def ndcg_at_k(users, rel, score, k=5):
    out = []
    for u in np.unique(users):
        m = users == u
        r, s = rel[m], score[m]
        top = r[np.argsort(-s, kind="mergesort")[:k]]
        ideal = np.sort(r)[::-1][:k]
        disc = 1 / np.log2(np.arange(2, len(top) + 2))
        out.append((top * disc).sum() / max((ideal * disc).sum(), 1e-9))
    return float(np.mean(out))


def heuristic_baseline(X):
    """Hand-written rule: overlap of selected interests with place axes (+ popularity)."""
    n = len(INTERESTS)
    inter = X[:, :n]
    per = X[:, N_USER:N_USER + 5]
    th = X[:, N_USER + 5:N_USER + 10]
    gem = X[:, N_USER + 10]
    sig = X[:, N_USER + 11]
    axes = np.concatenate([per, th[:, [0]], np.maximum(th[:, [1]], th[:, [2]]), gem[:, None]], axis=1)
    return (inter * axes).sum(1) / np.sqrt(np.maximum(axes.sum(1), 1)) + 0.3 * sig


def evaluate(name, y, p, users, true_prob, probabilistic=True):
    return {"set": name, "rows": int(len(y)), "auc": auc(y, p),
            "logloss": logloss(y, p) if probabilistic else None,
            "accuracy@0.5": float(((p >= 0.5) == (y == 1)).mean()) if probabilistic else None,
            "ndcg@5_vs_simulator_truth": ndcg_at_k(users, true_prob, p)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=os.path.join(HERE, "data", "synthetic_interactions.npz"))
    ap.add_argument("--device", default="auto", choices=["auto", "cpu", "gpu"])
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--batch", type=int, default=512)
    ap.add_argument("--lr", type=float, default=3e-3)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", default=os.path.join(HERE, "artifacts"))
    a = ap.parse_args()

    torch.manual_seed(a.seed); np.random.seed(a.seed)
    dev, info = pick_device(a.device)
    print(f"[TRAILS] training device: {info['device']} | backend: {info['backend']} | {info['device_name']} | torch {info['torch']}")

    d = np.load(a.data)
    X, y, P, U, R = d["X"], d["y"], d["true_prob"], d["user"], d["real_place"]
    meta = json.loads(str(d["meta"]))
    users = np.unique(U)
    rng = np.random.default_rng(a.seed); rng.shuffle(users)
    n = len(users)
    tr_u, va_u, te_u = set(users[: int(.7 * n)]), set(users[int(.7 * n): int(.85 * n)]), set(users[int(.85 * n):])
    mtr = np.isin(U, list(tr_u)); mva = np.isin(U, list(va_u)); mte = np.isin(U, list(te_u))
    print(f"[TRAILS] SYNTHETIC data: train {mtr.sum()} / val {mva.sum()} / test {mte.sum()} rows (split by user)")

    Xt = torch.tensor(X[mtr], device=dev); yt = torch.tensor(y[mtr], device=dev)
    Xv = torch.tensor(X[mva], device=dev)
    model = PreferenceMLP().to(dev)
    opt = torch.optim.Adam(model.parameters(), lr=a.lr, weight_decay=1e-5)
    lossf = nn.BCEWithLogitsLoss()
    best, best_state, patience, log = 1e9, None, 0, []
    t0 = time.perf_counter()
    for ep in range(a.epochs):
        model.train()
        perm = torch.randperm(len(Xt), device=dev)
        tot = 0.0
        for i in range(0, len(Xt), a.batch):
            idx = perm[i:i + a.batch]
            opt.zero_grad()
            loss = lossf(model(Xt[idx]), yt[idx])
            loss.backward(); opt.step()
            tot += loss.item() * len(idx)
        model.eval()
        with torch.no_grad():
            pv = torch.sigmoid(model(Xv)).cpu().numpy()
        vl = logloss(y[mva], pv)
        log.append({"epoch": ep + 1, "train_loss": tot / len(Xt), "val_logloss": vl})
        if vl < best - 1e-4:
            best, patience = vl, 0
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
        else:
            patience += 1
        if (ep + 1) % 5 == 0 or ep == 0:
            print(f"  epoch {ep + 1:3d}  train {tot / len(Xt):.4f}  val {vl:.4f}")
        if patience >= 8:
            print(f"  early stop at epoch {ep + 1}")
            break
    train_s = time.perf_counter() - t0
    if dev.type == "cuda":
        torch.cuda.synchronize()
    model.load_state_dict(best_state)
    model = model.cpu().eval()

    with torch.no_grad():
        pt = torch.sigmoid(model(torch.tensor(X[mte]))).numpy()
    yt_, ut, tp = y[mte], U[mte], P[mte]
    real = R[mte] == 1
    hb = heuristic_baseline(X[mte])
    metrics = {
        "WARNING": "All metrics are on SYNTHETIC simulated users. They show the network recovers the simulator's "
                   "preference structure; they are NOT evidence of real-world recommendation quality.",
        "schema_version": SCHEMA["schema_version"], "data": meta, "device": info,
        "training_seconds": round(train_s, 2), "epochs_run": len(log), "best_val_logloss": best,
        "architecture": "Linear(29,32)-ReLU-Linear(32,16)-ReLU-Linear(16,1)-Sigmoid",
        "parameters": int(sum(p.numel() for p in model.parameters())),
        "test": {
            "mlp": evaluate("held-out users, all places", yt_, pt, ut, tp),
            "mlp_real_rome_places_only": evaluate("held-out users, real Rome places", yt_[real], pt[real], ut[real], tp[real]),
            "baseline_popularity": evaluate("significance only", yt_, X[mte][:, N_USER + 11], ut, tp, False),
            "baseline_interest_overlap_rule": evaluate("hand-written rule", yt_, hb, ut, tp, False),
            "simulator_ceiling": evaluate("true simulator probability (upper bound)", yt_, tp, ut, tp),
        },
    }
    os.makedirs(a.out, exist_ok=True)
    torch.save(model.state_dict(), os.path.join(a.out, "preference_mlp.pt"))
    json.dump(log, open(os.path.join(a.out, "training_log.json"), "w"), indent=1)

    # ONNX export (portable inference format)
    try:
        dummy = torch.zeros(1, N_USER + N_PLACE)
        torch.onnx.export(model, dummy, os.path.join(a.out, "preference_mlp.onnx"), input_names=["features"],
                          output_names=["logit"], dynamic_axes={"features": {0: "batch"}, "logit": {0: "batch"}},
                          opset_version=17, dynamo=False)
        metrics["onnx"] = "ml/artifacts/preference_mlp.onnx"
    except Exception as e:  # keep training usable even if the exporter is missing
        metrics["onnx"] = f"export failed: {e}"
        print("[TRAILS] ONNX export failed:", e)

    # JSON weights for the browser
    layers = [m for m in model.net if isinstance(m, nn.Linear)]
    web = {"schema_version": SCHEMA["schema_version"], "format": "dense-relu-mlp/v1",
           "interests": INTERESTS, "trained_on": "synthetic bootstrap data (see ml/generate_data.py)",
           "trained_with": info["backend"] + " on " + info["device_name"],
           "test_auc_synthetic": metrics["test"]["mlp"]["auc"],
           "layers": [{"W": l.weight.detach().numpy().round(6).tolist(), "b": l.bias.detach().numpy().round(6).tolist()} for l in layers]}
    os.makedirs(os.path.join(ROOT, "public", "models"), exist_ok=True)
    json.dump(web, open(os.path.join(ROOT, "public", "models", "preference_mlp.json"), "w"))

    # parity fixture for the TypeScript implementation
    idx = np.random.default_rng(0).choice(int(mte.sum()), 25, replace=False)
    os.makedirs(os.path.join(ROOT, "tests", "fixtures"), exist_ok=True)
    json.dump({"inputs": X[mte][idx].tolist(), "outputs": pt[idx].tolist()},
              open(os.path.join(ROOT, "tests", "fixtures", "model_parity.json"), "w"))

    json.dump(metrics, open(os.path.join(a.out, "metrics.json"), "w"), indent=1)
    m = metrics["test"]
    print(f"[TRAILS] trained in {train_s:.1f}s on {info['backend']}")
    for k, v in m.items():
        ll = "  n/a" if v["logloss"] is None else f"{v['logloss']:.3f}"
        print(f"  {k:<34} AUC {v['auc']:.3f}  logloss {ll}  NDCG@5 {v['ndcg@5_vs_simulator_truth']:.3f}")
    print("[TRAILS] (synthetic data - see WARNING in metrics.json)")


if __name__ == "__main__":
    main()
