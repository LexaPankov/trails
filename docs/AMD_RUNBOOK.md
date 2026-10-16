# AMD Developer Cloud runbook

What to do on the day we get an AMD Instinct instance. Goal: the storyteller in the demo runs on an
AMD GPU, and the preference model is trained on one, with measured numbers committed to the repo.
Background: [STORYTELLER.md](STORYTELLER.md), [AMD_ROCM.md](AMD_ROCM.md).

## 0. On the AMD instance (once)

```bash
git clone https://github.com/LexaPankov/trails.git && cd trails
rocm-smi                      # the GPU must be listed
docker --version              # both scripts use AMD's ROCm containers
```

## 1. Storyteller model (about 10 min, mostly the weight download)

```bash
bash amd/serve_llm.sh                                            # Qwen2.5-7B-Instruct, no HF token needed
# or, once the Gemma licence is accepted on Hugging Face:
MODEL=google/gemma-3-12b-it HF_TOKEN=hf_... bash amd/serve_llm.sh
```

The script starts vLLM on `127.0.0.1:8000`, protects it with an API key (printed, and saved in
`~/.trails_vllm_key`) and waits until `/v1/models` answers. The port is not opened to the internet.

## 2. Measure it (from the laptop)

```bash
ssh -N -L 8000:localhost:8000 <user>@<amd-host>      # keep this running
```

In a second terminal, in the repository (PowerShell: set each variable with `$env:NAME="..."` first):

```bash
STORY_API_BASE=http://localhost:8000/v1 STORY_MODEL=Qwen/Qwen2.5-7B-Instruct STORY_API_KEY=<key> \
STORY_PROVIDER_LABEL="Qwen2.5 7B · vLLM on AMD Instinct <GPU> (ROCm)" npm run story:eval
```

This sends five fixed walks from the dataset and writes `docs/story_eval_<model>.json`: every story,
latency, tokens per second, stop coverage, and numbers in the story that are not in our facts
(possible inventions, read them). Put the real GPU name from `rocm-smi` in the label.

## 3. Demo with the AMD model

```bash
npm run build
# same STORY_* variables as above
npm run story                 # app + /api/story on http://localhost:8787
```

The story card shows the model id and the provider label, so judges see what actually ran.

## 4. Train the preference model on the GPU (about 5 min)

```bash
bash amd/train_rocm.sh        # inside rocm/pytorch; stops if PyTorch does not see the GPU via ROCm
```

Then commit `ml/artifacts/`, `public/models/preference_mlp.json`, `tests/fixtures/model_parity.json`
and run `npm test` locally (TypeScript parity against the GPU-trained weights).

## 5. Before quoting any number

Copy figures only from the committed JSON files (`docs/story_eval_*.json`,
`ml/artifacts/benchmark_*.json`). Update the status tables in README.md and docs/REPORT.md from
"not run on AMD" to what was actually run.
