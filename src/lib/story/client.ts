import { INTEREST_LABEL } from '../model/features'
import { MODE_LABEL } from '../optimizer'
import type { Plan } from '../planner'
import type { Profile } from '../profile'
import { buildStoryInput, offlineStory, type Story } from './core'

const API = (import.meta.env.VITE_STORY_API as string | undefined) ?? '/api'

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
  const local = () => offlineStory(buildStoryInput(args))
  if (opts.offline) return { story: local(), fallbackReason: 'Offline mode is on.' }
  try {
    const r = await fetch(`${API}/story`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...args, stops: undefined, stopIds: plan.stops.map((s) => s.place.id) }),
      signal: AbortSignal.timeout(50_000),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return { story: local(), fallbackReason: storyFailureReason(r.status, (j as { error?: string }).error) }
    if (!Array.isArray((j as Partial<Story>).segments)) return { story: local(), fallbackReason: UNREACHABLE }
    return { story: j as Story }
  } catch {
    // Network error, timeout, or a host that answered with something other than JSON.
    return { story: local(), fallbackReason: UNREACHABLE }
  }
}
