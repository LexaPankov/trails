// Run the TRAILS storyteller against a real model endpoint on fixed sample walks and record what happened.
//   STORY_API_BASE=http://localhost:8000/v1 STORY_MODEL=Qwen/Qwen2.5-7B-Instruct STORY_API_KEY=... \
//   STORY_PROVIDER_LABEL="vLLM on AMD Instinct MI300X (ROCm)" node --experimental-strip-types scripts/story_eval.ts
// Writes docs/story_eval_<model>.json with every story, latency, token throughput and grounding checks.
// Measured numbers only: a walk that fails is reported as failed, never retried silently.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const env = process.env
if (!env.STORY_API_BASE || !env.STORY_MODEL) {
  console.error('[TRAILS] set STORY_API_BASE (ending in /v1) and STORY_MODEL first')
  process.exit(1)
}
const ROOT = resolve(import.meta.dirname, '..')
const { tellStory } = await import('../server/story-server.ts')
const { buildMessages, buildStoryInput } = await import('../src/lib/story/core.ts')
const places = JSON.parse(readFileSync(join(ROOT, 'data/rome/places.json'), 'utf8')).places
const BY_ID = new Map(places.map((p: { id: string }) => [p.id, p]))

const WALKS = [
  { name: 'Ancient stones', start: 'Pantheon', end: 'Colosseum', mode: 'Cultural discovery', interests: ['Ancient Rome', 'Archaeology'],
    stopIds: ['temple-of-hadrian', 'trajans-column', 'roman-forum', 'arch-of-titus'], legMinutes: [4, 12, 6, 7, 5] },
  { name: 'Baroque squares', start: "Campo de' Fiori", end: 'Spanish Steps', mode: 'Maximum history', interests: ['Baroque', 'Art & architecture'],
    stopIds: ['piazza-navona', 'santagnese-in-agone', 'four-rivers-fountain', 'trevi-fountain'], legMinutes: [5, 1, 1, 14, 9] },
  { name: 'Towards the Vatican', start: 'Piazza Navona', end: "St Peter's Basilica", mode: 'Cultural discovery', interests: ['Renaissance', 'Religion'],
    stopIds: ['ponte-sant-angelo', 'castel-sant-angelo', 'st-peters-square'], legMinutes: [11, 3, 14, 4] },
  { name: 'River and ghetto', start: 'Largo di Torre Argentina', end: 'Bocca della Verità', mode: 'Maximum history', interests: ['Hidden gems', 'Ancient Rome'],
    stopIds: ['largo-di-torre-argentina', 'turtle-fountain', 'theatre-of-marcellus', 'temple-of-portunus', 'santa-maria-in-cosmedin'], legMinutes: [1, 4, 5, 6, 2, 2] },
  { name: 'One stop', start: 'Piazza Venezia', end: 'Piazza della Rotonda', mode: 'Fastest', interests: [],
    stopIds: ['pantheon'], legMinutes: [9, 2] },
]

// Numbers with 2+ digits in the story that do not appear anywhere in the facts we sent: likely invented.
function unsupportedNumbers(text: string, facts: string): string[] {
  const nums = text.match(/\b\d{2,4}\b/g) ?? []
  return [...new Set(nums.filter((n) => !facts.includes(n)))]
}

type Usage = { prompt_tokens?: number; completion_tokens?: number }
const results = []
for (const w of WALKS) {
  let usage: Usage = {}
  const spy = (async (url: string, init: RequestInit) => {
    const r = await fetch(url, init)
    try { usage = ((await r.clone().json()) as { usage?: Usage }).usage ?? {} } catch { /* body is checked by tellStory */ }
    return r
  }) as typeof fetch
  const input = buildStoryInput({ ...w, stops: w.stopIds.map((id) => BY_ID.get(id) as never) })
  const facts = buildMessages(input).map((m) => m.content).join('\n')
  const t0 = Date.now()
  try {
    const story = await tellStory({ ...w }, spy)
    const ms = Date.now() - t0
    const text = [story.title, story.intro, ...story.segments.map((s) => s.text), story.outro].join(' ')
    const row = {
      walk: w.name, ok: true, latencyMs: ms,
      promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens,
      tokensPerSecond: usage.completion_tokens ? Math.round((usage.completion_tokens / ms) * 1000 * 10) / 10 : undefined,
      stops: w.stopIds.length, segments: story.segments.length,
      missingStops: w.stopIds.filter((id) => !story.segments.some((s) => s.placeId === id)),
      citations: story.segments.reduce((a, s) => a + s.cite.length, 0),
      words: text.split(/\s+/).filter(Boolean).length,
      unsupportedNumbers: unsupportedNumbers(text, facts),
      story,
    }
    results.push(row)
    console.log(`[TRAILS] ${w.name}: ${ms} ms, ${row.segments}/${row.stops} stops, ${row.tokensPerSecond ?? '?'} tok/s` +
      (row.unsupportedNumbers.length ? `, check numbers: ${row.unsupportedNumbers.join(', ')}` : ''))
  } catch (e) {
    results.push({ walk: w.name, ok: false, latencyMs: Date.now() - t0, error: (e as Error).message })
    console.log(`[TRAILS] ${w.name}: FAILED (${(e as Error).message})`)
  }
}

const ok = results.filter((r) => r.ok) as { latencyMs: number; segments: number; stops: number; tokensPerSecond?: number; unsupportedNumbers: string[] }[]
const lat = ok.map((r) => r.latencyMs).sort((a, b) => a - b)
const tps = ok.map((r) => r.tokensPerSecond).filter((x): x is number => x !== undefined)
const summary = {
  walks: results.length, succeeded: ok.length,
  latencyMsMedian: lat.length ? lat[Math.floor(lat.length / 2)] : null,
  latencyMsMax: lat.length ? lat[lat.length - 1] : null,
  tokensPerSecondMedian: tps.length ? tps.sort((a, b) => a - b)[Math.floor(tps.length / 2)] : null,
  stopCoverage: ok.length ? `${ok.reduce((a, r) => a + r.segments, 0)}/${ok.reduce((a, r) => a + r.stops, 0)}` : null,
  walksWithUnsupportedNumbers: ok.filter((r) => r.unsupportedNumbers.length).length,
}
const report = {
  model: env.STORY_MODEL, provider: env.STORY_PROVIDER_LABEL ?? new URL(env.STORY_API_BASE).host,
  runAt: new Date().toISOString(),
  note: 'Each walk is called once; latency is wall time from this machine, including network. ' +
    'tokensPerSecond = completion tokens / that wall time, so it understates the GPU decode speed. ' +
    'Story caching is per-process, so every number here is a fresh model call.',
  summary, results,
}
mkdirSync(join(ROOT, 'docs'), { recursive: true })
const out = join(ROOT, 'docs', `story_eval_${env.STORY_MODEL.replace(/[^A-Za-z0-9.-]+/g, '_')}.json`)
writeFileSync(out, JSON.stringify(report, null, 1))
console.log('[TRAILS] summary:', summary)
console.log('->', out)
process.exit(ok.length ? 0 : 1)
