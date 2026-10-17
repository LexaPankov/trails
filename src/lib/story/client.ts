import { INTEREST_LABEL } from '../model/features'
import { MODE_LABEL } from '../optimizer'
import type { Plan } from '../planner'
import type { Profile } from '../profile'
import { buildStoryInput, offlineStory, storyKey, type Story } from './core'

// empty (an unset CI variable) means the same site's /api
const API = ((import.meta.env.VITE_STORY_API as string | undefined) || '/api').replace(/\/$/, '')

// Stories written ahead of time by the AMD-hosted model for the preset walks (scripts/pregen_stories.ts),
// so a static site with no story server still shows real model output for them.
let cacheP: Promise<Record<string, Story>> | null = null
function storyCache(): Promise<Record<string, Story>> {
  cacheP ??= fetch(`${import.meta.env.BASE_URL}data/story_cache.json`)
    .then((r) => (r.ok ? r.json() : { stories: {} }))
    .then((j: { stories?: Record<string, Story> }) => j.stories ?? {})
    .catch(() => ({}))
  return cacheP
}

export interface StoryResult { story: Story; fallbackReason?: string }

const UNREACHABLE = 'The AI storyteller is not reachable from this site, so this story comes from TRAILS\' own notes.'

/** Plain-language reason shown under an offline story when the story server did not answer with a story. */
export function storyFailureReason(status: number, serverError?: string): string {
  if (status === 503) return 'The AI storyteller is not set up on this server, so this story comes from TRAILS\' own notes.'
  if (status === 429) return 'Too many story requests just now, so this story comes from TRAILS\' own notes. Try again in a minute.'
  // A static host (Netlify, GitHub Pages) has no /api, and a proxy with no server behind it answers 5xx.
  if ([404, 405, 501, 502, 504].includes(status) || !serverError) return UNREACHABLE
  return serverError
}

/** Ask the story server (model on AMD hardware when configured); fall back to the offline assembler. */
export async function requestStory(plan: Plan, profile: Profile, opts: { offline?: boolean } = {}): Promise<StoryResult> {
  const legMinutes = plan.route.legs.map((l) => l.duration_s / 60)
  const args = {
    start: plan.request.start.label, end: plan.request.end.label, mode: MODE_LABEL[plan.request.mode],
    interests: profile.interests.map((k) => INTEREST_LABEL[k]), stops: plan.stops.map((s) => s.place), legMinutes,
  }
  const stopIds = plan.stops.map((s) => s.place.id)
  const local = () => offlineStory(buildStoryInput(args))
  const cached = async () => (await storyCache())[storyKey({ ...args, stopIds })]
  if (opts.offline) return { story: local(), fallbackReason: 'Offline mode is on.' }
  let reason = UNREACHABLE
  try {
    const r = await fetch(`${API}/story`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...args, stops: undefined, stopIds }),
      // a 31B model on the AMD endpoint took 9–50 s per story (docs/story_eval_*.json); the server gives up at 95 s
      signal: AbortSignal.timeout(100_000),
    })
    const j = await r.json().catch(() => ({}))
    if (r.ok && Array.isArray((j as Partial<Story>).segments)) return { story: j as Story }
    if (!r.ok) reason = storyFailureReason(r.status, (j as { error?: string }).error)
  } catch {
    // Network error, timeout, or a host that answered with something other than JSON.
  }
  const hit = await cached()
  return hit ? { story: hit } : { story: local(), fallbackReason: reason }
}
