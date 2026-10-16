// TRAILS story server: keeps the model API key off the client, grounds every request in places.json,
// calls any OpenAI-compatible chat endpoint (e.g. vLLM serving Gemma on an AMD Instinct GPU with ROCm),
// validates the answer and, if dist/ exists, also serves the built app.
//   node --experimental-strip-types server/story-server.ts
// Env: STORY_API_BASE (e.g. http://<amd-host>:8000/v1), STORY_API_KEY, STORY_MODEL,
//      STORY_PROVIDER_LABEL (shown in the app, e.g. "vLLM on AMD Instinct MI300X (ROCm)"), PORT (8787)
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { buildMessages, buildStoryInput, parseStory, type Story } from '../src/lib/story/core.ts'

const ROOT = resolve(import.meta.dirname, '..')
const PLACES = JSON.parse(readFileSync(join(ROOT, 'data/rome/places.json'), 'utf8')).places as { id: string }[]
const BY_ID = new Map(PLACES.map((p) => [p.id, p]))
const env = process.env
const API_BASE = (env.STORY_API_BASE ?? '').replace(/\/$/, '')
const MODEL = env.STORY_MODEL ?? ''
const PROVIDER = env.STORY_PROVIDER_LABEL ?? (API_BASE ? new URL(API_BASE).host : '')
const PORT = Number(env.PORT ?? 8787)
const TIMEOUT_MS = Number(env.STORY_TIMEOUT_MS ?? 45000)
const configured = Boolean(API_BASE && MODEL)
// Sites allowed to call /api from another origin, e.g. the Netlify demo built with VITE_STORY_API=https://<this server>/api.
// Comma-separated list of origins, or * for any. Unset = same-origin only (the default).
const ALLOW_ORIGINS = (env.STORY_ALLOW_ORIGIN ?? '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean)

/** CORS headers for a request's Origin, or none when that origin is not allowed. */
export function corsHeaders(origin: string | undefined, allowed: string[] = ALLOW_ORIGINS): Record<string, string> {
  const list = allowed.map((a) => a.replace(/\/$/, ''))
  if (!origin || !list.length) return {}
  if (!list.includes('*') && !list.includes(origin.replace(/\/$/, ''))) return {}
  return {
    'access-control-allow-origin': allowed.includes('*') ? '*' : origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '600',
    vary: 'Origin',
  }
}

const cache = new Map<string, Story>()
const hits = new Map<string, number[]>()

function send(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...corsHeaders(res.req?.headers.origin) })
  res.end(JSON.stringify(body))
}

function limited(ip: string): boolean {
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000)
  recent.push(now)
  hits.set(ip, recent)
  return recent.length > 20
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > 16_000) throw new Error('body too large')
    chunks.push(c as Buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')

export async function tellStory(body: Record<string, unknown>, fetchImpl: typeof fetch = fetch): Promise<Story> {
  const ids = Array.isArray(body.stopIds) ? body.stopIds.filter((x): x is string => typeof x === 'string') : []
  if (ids.length > 10 || ids.some((id) => !BY_ID.has(id))) throw Object.assign(new Error('unknown or too many stops'), { status: 400 })
  const input = buildStoryInput({
    start: clean(body.start, 80) || 'your start', end: clean(body.end, 80) || 'your destination',
    mode: clean(body.mode, 20), interests: Array.isArray(body.interests) ? body.interests.slice(0, 8).map((x) => clean(x, 30)) : [],
    stops: ids.map((id) => BY_ID.get(id) as never),
    legMinutes: Array.isArray(body.legMinutes) ? body.legMinutes.slice(0, 11).map(Number) : undefined,
  })
  const key = JSON.stringify(input)
  const hit = cache.get(key)
  if (hit) return hit
  const t0 = Date.now()
  const r = await fetchImpl(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(env.STORY_API_KEY ? { authorization: `Bearer ${env.STORY_API_KEY}` } : {}) },
    body: JSON.stringify({ model: MODEL, messages: buildMessages(input), temperature: 0.4, max_tokens: 1200 }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!r.ok) throw Object.assign(new Error(`model endpoint answered ${r.status}`), { status: 502 })
  const j = (await r.json()) as { model?: string; choices?: { message?: { content?: string } }[] }
  const text = j.choices?.[0]?.message?.content ?? ''
  const story: Story = { ...parseStory(text, input), generator: { kind: 'model', model: j.model ?? MODEL, provider: PROVIDER, latencyMs: Date.now() - t0 } }
  if (cache.size > 200) cache.clear()
  cache.set(key, story)
  return story
}

const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.tflite': 'application/octet-stream',
  '.woff2': 'font/woff2', '.onnx': 'application/octet-stream',
}
const DIST = join(ROOT, 'dist')

function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x')
  let file = normalize(join(DIST, decodeURIComponent(url.pathname)))
  if (!file.startsWith(DIST)) return send(res, 403, { error: 'forbidden' })
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html')
  if (!existsSync(file)) return send(res, 404, { error: 'not found (run npm run build to serve the app here)' })
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
}

export function startServer(port = PORT) {
  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS' && req.url?.startsWith('/api/')) {
        const h = corsHeaders(req.headers.origin)
        res.writeHead(Object.keys(h).length ? 204 : 403, h)
        return res.end()
      }
      if (req.url === '/api/health') return send(res, 200, { configured, model: configured ? MODEL : null, provider: configured ? PROVIDER : null })
      if (req.url === '/api/story' && req.method === 'POST') {
        if (!configured) return send(res, 503, { error: 'storyteller not configured (set STORY_API_BASE and STORY_MODEL)' })
        if (limited(req.socket.remoteAddress ?? '?')) return send(res, 429, { error: 'too many requests' })
        return send(res, 200, await tellStory((await readBody(req)) as Record<string, unknown>))
      }
      if (req.url?.startsWith('/api/')) return send(res, 404, { error: 'not found' })
      serveStatic(req, res)
    } catch (e) {
      const err = e as Error & { status?: number }
      send(res, err.status ?? 500, { error: err.message })
    }
  })
  server.listen(port, () => console.log(`[TRAILS] story server on :${port} | model: ${configured ? `${MODEL} @ ${PROVIDER}` : 'not configured (app will use offline stories)'}${ALLOW_ORIGINS.length ? ` | cross-origin calls allowed from: ${ALLOW_ORIGINS.join(', ')}` : ''}`))
  return server
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) startServer()
