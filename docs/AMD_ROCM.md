# Training the TRAILS preference model on AMD GPUs (ROCm)

The TRAILS recommender is a PyTorch MLP (`ml/train.py`). The same script runs on an AMD GPU through
ROCm, or on CPU when no GPU is present. The deployed web app never needs a GPU: it runs the exported
weights in plain TypeScript.

## What has and has not been tested

| Step | Status |
| --- | --- |
| Data generation, training, evaluation, ONNX + web export on CPU | Run and passing (see `ml/artifacts/metrics.json`, `benchmark_vm.json`) |
| Training on an AMD GPU with ROCm | **Not run yet.** No AMD GPU was available in the build environment. Follow the steps below on AMD Developer Cloud and commit the resulting `ml/artifacts/benchmark_<host>.json`. |

Do not quote GPU numbers until `ml/benchmark.py` has produced them on real hardware.

## 1. Get a ROCm machine

AMD Developer Cloud provides Instinct GPU instances with ROCm preinstalled. After logging in, check:

```bash
rocm-smi            # lists the GPU(s)
```

## 2. Get PyTorch with ROCm

Option A, AMD's container (simplest):

```bash
docker run -it --device=/dev/kfd --device=/dev/dri --group-add video --ipc=host \
  -v "$PWD":/work -w /work rocm/pytorch:latest
```

Option B, pip wheels: use the ROCm index URL that pytorch.org lists for your ROCm version, for example

```bash
python -m pip install torch --index-url https://download.pytorch.org/whl/rocm6.2   # match your ROCm version
python -m pip install numpy onnx onnxruntime
```

Verify the build sees the GPU (ROCm GPUs are exposed through the `torch.cuda` API):

```bash
python -c "import torch; print(torch.__version__, torch.version.hip, torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

`torch.version.hip` must be non-empty, otherwise you have a CUDA or CPU build.

## 3. Train, evaluate, benchmark

From the repository root:

```bash
python ml/generate_data.py                 # synthetic bootstrap data (labelled as synthetic)
python ml/train.py --device gpu            # fails loudly if no GPU; use --device auto to fall back to CPU
python ml/check_export.py                  # PyTorch vs ONNX Runtime vs web-weights parity
python ml/benchmark.py                     # same workload on CPU and on the AMD GPU
```

`train.py` prints the device it actually used, for example

```
[TRAILS] training device: cuda | backend: ROCm/HIP 6.x | AMD Instinct ... | torch 2.x+rocm6.x
```

and records it in `ml/artifacts/metrics.json` (`device.backend`). The exported model in
`public/models/preference_mlp.json` carries a `trained_with` field that the app shows in its UI.

## 4. Deploy the GPU-trained model

Commit `public/models/preference_mlp.json`, `ml/artifacts/*` and `tests/fixtures/model_parity.json`,
then run `npm test` (the TypeScript parity test checks the browser inference against PyTorch) and
redeploy the static site. No server or GPU is needed at runtime.

## Why a GPU for a model this small?

The MLP has about 1.5k parameters, and on CPU one training epoch over 240k synthetic rows takes about
half a second in the build environment, so a GPU will not change the user experience. The ROCm path is there so
the same pipeline scales when the training set grows (real interaction logs, more cities, wider
features) and so the benchmark can measure the CPU/GPU trade-off honestly on the same workload.
