"""Benchmark the TRAILS preference MLP on every available device with the same workload.

    python ml/benchmark.py            # CPU, plus AMD GPU via ROCm if torch.cuda.is_available()

Writes ml/artifacts/benchmark_<hostname>.json with real measurements only. Devices that are
not present are reported as "unavailable", never estimated.
"""
import json
import os
import platform
import socket
import time

import numpy as np
import torch
from torch import nn

from train import HERE, PreferenceMLP, pick_device


def bench(dev, X, y, epochs=3, batch=512, infer_batch=65536, reps=20):
    torch.manual_seed(0)
    m = PreferenceMLP().to(dev)
    opt = torch.optim.Adam(m.parameters(), lr=3e-3)
    lossf = nn.BCEWithLogitsLoss()
    Xt, yt = torch.tensor(X, device=dev), torch.tensor(y, device=dev)
    sync = (lambda: torch.cuda.synchronize()) if dev.type == "cuda" else (lambda: None)
    # warm-up
    for i in range(0, 4096, batch):
        opt.zero_grad(); lossf(m(Xt[i:i + batch]), yt[i:i + batch]).backward(); opt.step()
    sync(); t = time.perf_counter()
    for _ in range(epochs):
        for i in range(0, len(Xt), batch):
            opt.zero_grad(); lossf(m(Xt[i:i + batch]), yt[i:i + batch]).backward(); opt.step()
    sync(); train_epoch = (time.perf_counter() - t) / epochs
    m.eval(); xb = Xt[:infer_batch]; xs = Xt[:74]
    with torch.no_grad():
        for _ in range(3): m(xb); m(xs)
        sync(); t = time.perf_counter()
        for _ in range(reps): m(xb)
        sync(); big = (time.perf_counter() - t) / reps
        t = time.perf_counter()
        for _ in range(reps * 10): m(xs)
        sync(); small = (time.perf_counter() - t) / (reps * 10)
    return {"train_epoch_seconds": round(train_epoch, 4), "rows_per_epoch": int(len(Xt)), "batch": batch,
            "inference_rows_per_second_batch_65536": round(len(xb) / big),
            "inference_latency_ms_74_places": round(small * 1000, 4)}


def main():
    d = np.load(os.path.join(HERE, "data", "synthetic_interactions.npz"))
    X, y = d["X"], d["y"]
    res = {"host": socket.gethostname(), "platform": platform.platform(), "torch": torch.__version__,
           "workload": "TRAILS preference MLP, synthetic interactions", "results": {}}
    dev, info = pick_device("cpu")
    res["results"]["cpu"] = {"device": info, **bench(dev, X, y)}
    print("[TRAILS] cpu:", res["results"]["cpu"])
    if torch.cuda.is_available():
        dev, info = pick_device("gpu")
        res["results"]["gpu"] = {"device": info, **bench(dev, X, y)}
        print("[TRAILS] gpu:", res["results"]["gpu"])
    else:
        res["results"]["gpu"] = "unavailable on this machine (torch.cuda.is_available() is False)"
        print("[TRAILS] gpu: unavailable")
    os.makedirs(os.path.join(HERE, "artifacts"), exist_ok=True)
    path = os.path.join(HERE, "artifacts", f"benchmark_{res['host']}.json")
    json.dump(res, open(path, "w"), indent=1)
    print("->", path)


if __name__ == "__main__":
    main()
