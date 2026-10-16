#!/usr/bin/env bash
# Train, verify and benchmark the TRAILS preference MLP on an AMD GPU (ROCm), from the repository root.
#
#   bash amd/train_rocm.sh            # runs inside AMD's rocm/pytorch container (Docker)
#   NO_DOCKER=1 bash amd/train_rocm.sh   # use the host Python (needs a ROCm build of PyTorch)
#
# Writes ml/artifacts/*, public/models/preference_mlp.json and tests/fixtures/model_parity.json.
# Commit those afterwards and run `npm test` (TypeScript parity test against the GPU-trained weights).
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE="${PYTORCH_IMAGE:-rocm/pytorch:latest}"

if [ -z "${NO_DOCKER:-}" ] && [ -z "${TRAILS_IN_CONTAINER:-}" ]; then
  echo "[TRAILS] running in $IMAGE"
  exec docker run --rm --device=/dev/kfd --device=/dev/dri --group-add video --ipc=host \
    --security-opt seccomp=unconfined -e TRAILS_IN_CONTAINER=1 -h "amd-$(hostname -s)" \
    -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
    -v "$PWD":/work -w /work "$IMAGE" bash amd/train_rocm.sh
fi

python - <<'EOF'
import torch, sys
hip = torch.version.hip
print(f"[TRAILS] torch {torch.__version__} | hip {hip} | gpu available {torch.cuda.is_available()}")
if not hip or not torch.cuda.is_available():
    sys.exit("[TRAILS] this PyTorch build does not see an AMD GPU through ROCm; stopping")
print("[TRAILS] device:", torch.cuda.get_device_name(0))
EOF

python -m pip install --quiet "numpy>=1.26" "onnx>=1.16" "onnxruntime>=1.18"
python ml/generate_data.py
python ml/train.py --device gpu 2>&1 | tee ml/artifacts/train_rocm.log
python ml/check_export.py
python ml/benchmark.py
(rocm-smi --showproductname --showdriverversion 2>/dev/null || true) > ml/artifacts/rocm_smi.txt
# files written by root in the container go back to the host user
[ -n "${HOST_UID:-}" ] && chown -R "$HOST_UID:$HOST_GID" ml public/models tests/fixtures || true

echo
echo "[TRAILS] done. Commit: ml/artifacts/ public/models/preference_mlp.json tests/fixtures/model_parity.json"
