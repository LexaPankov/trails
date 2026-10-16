import { INTEREST_LABEL } from '../model/features'
import { MODE_LABEL } from '../optimizer'
import type { Plan } from '../planner'
import type { Profile } from '../profile'
import { buildStoryInput, offlineStory, type Story } from './core'

const API = (import.meta.env.VITE_STORY_API as string | undefined) ?? '/api'

export interface StoryResult { story: Story; fallbackReason?: string }

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
    if (r.status === 503) throw new Error('The AI storyteller is not set up on this server, so this story comes from TRAILS\' own notes.')
    if (!r.ok) throw new Error((j as { error?: string }).error ?? `story server answered ${r.status}`)
    return { story: j as Story }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { story: local(), fallbackReason: /fetch|network|Failed|JSON|404|abort|timed out/i.test(msg) ? 'The story server is not reachable.' : msg }
  }
}
