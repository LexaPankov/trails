// Pre-generate AI stories for the preset walks, so the static site (GitHub Pages, no story server, no key)
// still shows real model output for them. Drives the real app in headless Chromium against a running
// story server, so the walk keys match exactly what the browser computes.
//   1. set STORY_API_BASE / STORY_MODEL / STORY_API_KEY / STORY_PROVIDER_LABEL, npm run build, npm run story
//   2. node --experimental-strip-types scripts/pregen_stories.ts [--url http://localhost:8787]
// Writes public/data/story_cache.json. Each story keeps the model and provider that actually wrote it.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { storyKey, type Story } from '../src/lib/story/core.ts'

const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:8787'
const ALL = ['Ancient stones', 'Renaissance & Baroque', 'Station to Trastevere', 'Hidden Rome']
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null
const PRESETS = only ? ALL.filter((p) => p === only) : ALL
const date = new Date().toISOString().slice(0, 10)
const OUT = 'public/data/story_cache.json'

const browser = await chromium.launch()
// keep stories from earlier runs, so one slow preset can be retried on its own (--only "Hidden Rome")
const stories: Record<string, Story> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')).stories ?? {} : {}
const log: { preset: string; key?: string; ok: boolean; note: string }[] = []
for (const preset of PRESETS) {
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 860 } })).newPage()
  try {
    await page.goto(url + '/#/')
    await page.getByRole('button', { name: new RegExp(preset.replace(/[&]/g, '.')) }).click()
    await page.getByRole('heading', { name: 'Your stops' }).waitFor({ timeout: 30000 })
    const resP = page.waitForResponse((r) => r.url().endsWith('/api/story'), { timeout: 240000 })
    await page.getByRole('button', { name: /Tell me the story/ }).click()
    const res = await resP
    const body = JSON.parse(res.request().postData() ?? '{}')
    const story = (await res.json()) as Story
    if (!res.ok() || story.generator?.kind !== 'model' || !story.segments?.length) throw new Error(`no model story (HTTP ${res.status()})`)
    const key = storyKey(body)
    stories[key] = { ...story, generator: { ...story.generator, pregenerated: date } }
    log.push({ preset, key, ok: true, note: `${story.segments.length} segments, ${((story.generator.latencyMs ?? 0) / 1000).toFixed(1)} s` })
  } catch (e) {
    log.push({ preset, ok: false, note: (e as Error).message.split('\n')[0] })
  }
  await page.context().close()
}
await browser.close()
for (const l of log) console.log(`[TRAILS] ${l.ok ? 'OK  ' : 'FAIL'} ${l.preset}: ${l.note}`)
if (!Object.keys(stories).length) process.exit(1)
writeFileSync(OUT, JSON.stringify({
  note: 'Stories written ahead of time for the preset walks by the model named in each generator, then validated ' +
    'like live stories (unknown places and citations dropped). Shown only when no story server answers.',
  created: date, stories,
}, null, 1))
console.log(`-> ${OUT} (${Object.keys(stories).length} stories)`)
