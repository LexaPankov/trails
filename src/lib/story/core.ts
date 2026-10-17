// TRAILS storyteller core, shared by the browser and server/story-server.ts.
// Self-contained on purpose (type-only imports) so Node can run it with --experimental-strip-types.
// Grounding rule: the model may only use the facts passed in here, and every citation it returns is
// checked against the numbered sources we supplied. Anything else is dropped.
import type { Place } from '../types'

export interface StoryStopInput {
  id: string
  name: string
  built?: string
  summary: string
  then_now?: string
  history?: string
  walkMinFromPrev?: number
  sources: { n: number; title: string; url: string }[]
}

export interface StoryInput {
  start: string
  end: string
  mode: string
  interests: string[]
  stops: StoryStopInput[]
}

export interface StorySegment { placeId: string; text: string; cite: number[] }

export interface Story {
  title: string
  intro: string
  segments: StorySegment[]
  outro: string
  sources: { n: number; title: string; url: string }[]
  /** who wrote it: the configured model, or the offline assembler */
  generator: { kind: 'model' | 'offline'; model?: string; provider?: string; latencyMs?: number }
}

const MAX_HISTORY = 700

export function buildStoryInput(args: {
  start: string; end: string; mode: string; interests: string[]
  stops: Place[]; legMinutes?: number[]
}): StoryInput {
  let n = 0
  const stops = args.stops.slice(0, 10).map((p, i) => ({
    id: p.id,
    name: p.name,
    built: p.built,
    summary: p.summary,
    then_now: p.then_now,
    history: p.history ? p.history.slice(0, MAX_HISTORY) : undefined,
    walkMinFromPrev: args.legMinutes?.[i] !== undefined ? Math.round(args.legMinutes[i]) : undefined,
    sources: p.sources.slice(0, 2).map((s) => ({ n: ++n, title: s.title, url: s.url })),
  }))
  return { start: args.start, end: args.end, mode: args.mode, interests: args.interests, stops }
}

export function buildMessages(input: StoryInput): { role: 'system' | 'user'; content: string }[] {
  const facts = input.stops.map((s, i) => [
    `STOP ${i + 1} id=${s.id}: ${s.name}${s.built ? ` (built: ${s.built})` : ''}`,
    s.walkMinFromPrev !== undefined ? `walk from previous point: about ${s.walkMinFromPrev} min` : '',
    `summary: ${s.summary}`,
    s.then_now ? `then and now: ${s.then_now}` : '',
    s.history ? `history: ${s.history}` : '',
    `sources: ${s.sources.map((x) => `[${x.n}] ${x.title}`).join('; ')}`,
  ].filter(Boolean).join('\n')).join('\n\n')
  const system = [
    'You are the narrator of TRAILS, a walking app for Rome. Write one connected story for a walk.',
    'Use ONLY the facts given in the user message. Do not add dates, names, numbers, quotes or legends that are not in those facts.',
    'If a fact is missing, leave it out rather than guess. Write in English, second person, warm and vivid but precise.',
    'Connect the stops into one thread (how one era leads to the next, or what the stops share), tuned to the walker\'s interests.',
    'Each segment is 2 to 4 sentences, about one stop, and cites the source numbers it used.',
    'Return ONLY JSON: {"title": string, "intro": string, "segments": [{"placeId": string, "text": string, "cite": number[]}], "outro": string}.',
  ].join(' ')
  const user = [
    `Walk: from ${input.start} to ${input.end}. Route mode: ${input.mode}.`,
    `Walker's interests: ${input.interests.length ? input.interests.join(', ') : 'general'}.`,
    '',
    facts || 'No stops on this walk; tell a short story about the direct walk using only the start and end names.',
  ].join('\n')
  return [{ role: 'system', content: system }, { role: 'user', content: user }]
}

function extractJson(text: string): unknown {
  const a = text.indexOf('{'), b = text.lastIndexOf('}')
  if (a < 0 || b <= a) throw new Error('no JSON object in model output')
  return JSON.parse(text.slice(a, b + 1))
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** Parse and validate model output: unknown stops and citations outside the supplied sources are dropped. */
export function parseStory(text: string, input: StoryInput): Omit<Story, 'generator'> {
  const raw = extractJson(text) as Record<string, unknown>
  const valid = new Map(input.stops.map((s) => [s.id, new Set(s.sources.map((x) => x.n))]))
  const allSources = input.stops.flatMap((s) => s.sources)
  const segs = Array.isArray(raw.segments) ? raw.segments : []
  const segments: StorySegment[] = []
  for (const s of segs as Record<string, unknown>[]) {
    const placeId = str(s?.placeId, 80)
    // models often also write "[1]" or "[1, 2]" into the text; the app draws citations itself, so move them to cite
    const inline = [...str(s?.text, 900).matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)].flatMap((m) => m[1].split(',').map(Number))
    const text = str(s?.text, 900).replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, '').trim()
    if (!valid.has(placeId) || !text || segments.some((x) => x.placeId === placeId)) continue
    const ok = valid.get(placeId)!
    const cite = [...new Set([...(Array.isArray(s.cite) ? s.cite : []), ...inline].map(Number))].filter((n) => ok.has(n))
    segments.push({ placeId, text, cite: cite.length ? cite : [...ok] })
  }
  if (input.stops.length && !segments.length) throw new Error('model output had no usable segments')
  const used = new Set(segments.flatMap((s) => s.cite))
  return {
    title: str(raw.title, 120) || `From ${input.start} to ${input.end}`,
    intro: str(raw.intro, 700),
    segments,
    outro: str(raw.outro, 500),
    sources: allSources.filter((x) => used.has(x.n)),
  }
}

/** Deterministic story assembled from our own notes. Used when no model is reachable (indoor demo, offline). */
export function offlineStory(input: StoryInput): Story {
  const segments = input.stops.map((s, i) => {
    const lead = i === 0
      ? (s.walkMinFromPrev !== undefined ? `About ${s.walkMinFromPrev} minutes from ${input.start}.` : '')
      : (s.walkMinFromPrev !== undefined ? `About ${s.walkMinFromPrev} minutes on.` : '')
    const body = [s.summary, s.then_now].filter(Boolean).join(' ')
    return { placeId: s.id, text: `${lead} ${body}`.trim(), cite: s.sources.map((x) => x.n) }
  })
  return {
    title: `From ${input.start} to ${input.end}`,
    intro: input.stops.length
      ? `${input.stops.length} stop${input.stops.length === 1 ? '' : 's'} on this walk, chosen for your interests.`
      : 'A direct walk, with no stops that fit your time.',
    segments,
    outro: `You arrive at ${input.end}.`,
    sources: input.stops.flatMap((s) => s.sources),
    generator: { kind: 'offline' },
  }
}
