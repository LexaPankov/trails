#!/usr/bin/env bash
# Start the TRAILS storyteller model with vLLM on an AMD Instinct GPU (ROCm) and wait until it answers.
#
#   bash amd/serve_llm.sh                         # open model, no Hugging Face token needed
#   MODEL=google/gemma-3-12b-it HF_TOKEN=hf_... bash amd/serve_llm.sh   # Gemma (licence accepted on HF)
#
# Env: MODEL (default Qwen/Qwen2.5-7B-Instruct), PORT (8000), VLLM_IMAGE (rocm/vllm:latest),
#      VLLM_API_KEY (generated if unset), MAX_MODEL_LEN (8192), HF_TOKEN (gated models only),
#      EXTRA_ARGS (passed to `vllm serve`).
# The endpoint is protected by VLLM_API_KEY. Prefer an SSH tunnel to opening the port:
#   ssh -N -L 8000:localhost:8000 <user>@<amd-host>
set -euo pipefail

MODEL="${MODEL:-Qwen/Qwen2.5-7B-Instruct}"
PORT="${PORT:-8000}"
VLLM_IMAGE="${VLLM_IMAGE:-rocm/vllm:latest}"
MAX_MODEL_LEN="${MAX_MODEL_LEN:-8192}"
NAME="trails-llm"
KEY_FILE="$HOME/.trails_vllm_key"

say() { printf '[TRAILS] %s\n' "$*"; }

command -v docker >/dev/null || { say "docker not found"; exit 1; }
if command -v rocm-smi >/dev/null; then
  rocm-smi --showproductname || true
else
  say "rocm-smi not found: is this an AMD ROCm machine?"
fi
[ -e /dev/kfd ] || { say "/dev/kfd missing: no ROCm GPU visible on this host"; exit 1; }

case "$MODEL" in
  google/gemma*|meta-llama/*|mistralai/*)
    [ -n "${HF_TOKEN:-}" ] || { say "$MODEL is gated on Hugging Face: set HF_TOKEN (and accept the licence) or use the default open model"; exit 1; } ;;
esac

if [ -z "${VLLM_API_KEY:-}" ]; then
  if [ -s "$KEY_FILE" ]; then VLLM_API_KEY="$(cat "$KEY_FILE")"
  else VLLM_API_KEY="trails-$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"; umask 077; echo "$VLLM_API_KEY" > "$KEY_FILE"; fi
fi

docker rm -f "$NAME" >/dev/null 2>&1 || true
say "starting $MODEL with $VLLM_IMAGE on port $PORT"
docker run -d --name "$NAME" \
  --device=/dev/kfd --device=/dev/dri --group-add video --ipc=host --shm-size 16g \
  --security-opt seccomp=unconfined \
  -p "127.0.0.1:$PORT:8000" \
  -v "$HOME/.cache/huggingface:/root/.cache/huggingface" \
  -e HF_TOKEN="${HF_TOKEN:-}" -e VLLM_API_KEY="$VLLM_API_KEY" \
  "$VLLM_IMAGE" \
  vllm serve "$MODEL" --host 0.0.0.0 --port 8000 --max-model-len "$MAX_MODEL_LEN" ${EXTRA_ARGS:-} >/dev/null

say "waiting for the model to load (first run downloads the weights, this can take several minutes)"
for i in $(seq 1 180); do
  if curl -fsS -H "Authorization: Bearer $VLLM_API_KEY" "http://127.0.0.1:$PORT/v1/models" >/dev/null 2>&1; then
    say "ready after ~$((i * 5)) s"
    break
  fi
  if ! docker ps -q -f name="^${NAME}$" | grep -q .; then
    say "container exited; last log lines:"; docker logs --tail 40 "$NAME" || true; exit 1
  fi
  sleep 5
done
curl -fsS -H "Authorization: Bearer $VLLM_API_KEY" "http://127.0.0.1:$PORT/v1/models" >/dev/null || {
  say "model did not become ready in 15 min; see: docker logs $NAME"; exit 1; }

docker exec "$NAME" sh -c 'rocm-smi --showproductname --showmeminfo vram 2>/dev/null' | tee "$HOME/trails_gpu_info.txt" || true

cat <<EOF

[TRAILS] Storyteller endpoint is up (bound to 127.0.0.1 on this host).
  Model:   $MODEL
  API key: $VLLM_API_KEY   (also in $KEY_FILE)

On your laptop:
  ssh -N -L $PORT:localhost:$PORT <user>@<this-host>
  STORY_API_BASE=http://localhost:$PORT/v1 STORY_MODEL=$MODEL STORY_API_KEY=<key above> \\
    node --experimental-strip-types scripts/story_eval.ts
Logs: docker logs -f $NAME      Stop: docker rm -f $NAME
EOF
