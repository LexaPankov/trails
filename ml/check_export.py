"""Verify exported artifacts agree: PyTorch state dict vs ONNX Runtime vs JSON weights (NumPy)."""
import json, os
import numpy as np, torch
from train import PreferenceMLP, ROOT, HERE

fx = json.load(open(os.path.join(ROOT, "tests", "fixtures", "model_parity.json")))
X = np.array(fx["inputs"], np.float32)
m = PreferenceMLP(); m.load_state_dict(torch.load(os.path.join(HERE, "artifacts", "preference_mlp.pt"))); m.eval()
with torch.no_grad():
    p_torch = torch.sigmoid(m(torch.tensor(X))).numpy()
w = json.load(open(os.path.join(ROOT, "public", "models", "preference_mlp.json")))
h = X
for i, l in enumerate(w["layers"]):
    h = h @ np.array(l["W"], np.float32).T + np.array(l["b"], np.float32)
    if i < len(w["layers"]) - 1: h = np.maximum(h, 0)
p_json = 1 / (1 + np.exp(-h[:, 0]))
out = {"torch_vs_json_max_abs": float(np.abs(p_torch - p_json).max())}
try:
    import onnxruntime as ort
    s = ort.InferenceSession(os.path.join(HERE, "artifacts", "preference_mlp.onnx"), providers=["CPUExecutionProvider"])
    p_onnx = 1 / (1 + np.exp(-s.run(None, {"features": X})[0]))
    out["torch_vs_onnx_max_abs"] = float(np.abs(p_torch - p_onnx).max())
except Exception as e:
    out["onnx"] = f"not checked: {e}"
print(json.dumps(out))
assert out["torch_vs_json_max_abs"] < 1e-4 and out.get("torch_vs_onnx_max_abs", 0) < 1e-5
print("export parity OK")
