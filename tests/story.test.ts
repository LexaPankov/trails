import { describe, expect, it } from 'vitest'
import { PLACE_BY_ID } from '../src/lib/data'
import { buildMessages, buildStoryInput, offlineStory, parseStory } from '../src/lib/story/core'

const input = buildStoryInput({
  start: 'Pantheon', end: 'Colosseum', mode: 'Cultural discovery', interests: ['Ancient Rome'],
  stops: [PLACE_BY_ID['trajans-column'], PLACE_BY_ID['temple-of-hadrian']], legMinutes: [9, 6, 12],
})

describe('storyteller grounding', () => {
  it('puts only dataset facts and numbered sources in the prompt', () => {
    const [sys, user] = buildMessages(input)
    expect(sys.content).toMatch(/ONLY the facts/)
    expect(user.content).toContain(PLACE_BY_ID['trajans-column'].summary)
    expect(user.content).toContain('[1]')
    expect(user.content).toContain('about 9 min')
  })
  it('drops unknown stops, duplicate stops and citations that were never supplied', () => {
    const out = parseStory('Sure! ' + JSON.stringify({
      title: 'Stone and empire', intro: 'Hi.',
      segments: [
        { placeId: 'trajans-column', text: 'A column.', cite: [1, 99] },
        { placeId: 'made-up-place', text: 'Invented.', cite: [1] },
        { placeId: 'trajans-column', text: 'Again.', cite: [1] },
        { placeId: 'temple-of-hadrian', text: 'A temple.', cite: [] },
      ], outro: 'Bye.',
    }), input)
    expect(out.segments.map((s) => s.placeId)).toEqual(['trajans-column', 'temple-of-hadrian'])
    expect(out.segments[0].cite).toEqual([1])
    expect(out.segments[1].cite.length).toBeGreaterThan(0)
    expect(out.sources.every((s) => s.n !== 99)).toBe(true)
  })
  it('rejects output without usable segments', () => {
    expect(() => parseStory('{"title":"x","segments":[]}', input)).toThrow()
    expect(() => parseStory('no json here', input)).toThrow()
  })
  it('offline story covers every stop and says it is offline', () => {
    const s = offlineStory(input)
    expect(s.generator.kind).toBe('offline')
    expect(s.segments.map((x) => x.placeId)).toEqual(['trajans-column', 'temple-of-hadrian'])
    expect(s.segments[1].text).toMatch(/About 6 minutes on/)
  })
})

describe('story server', () => {
  it('calls an OpenAI-compatible endpoint, validates and labels the answer', async () => {
    const { tellStory } = await import('../server/story-server')
    let sent: { model?: string; messages?: unknown[] } = {}
    const fake = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body))
      return new Response(JSON.stringify({ model: 'gemma-test', choices: [{ message: { content: JSON.stringify({
        title: 't', intro: 'i', segments: [{ placeId: 'trajans-column', text: 'x', cite: [1] }], outro: 'o' }) } }] }))
    }) as typeof fetch
    const story = await tellStory({ stopIds: ['trajans-column'], start: 'A', end: 'B', interests: [] }, fake)
    expect(sent.messages?.length).toBe(2)
    expect(story.generator).toMatchObject({ kind: 'model', model: 'gemma-test' })
    expect(story.segments[0].cite).toEqual([1])
  })
  it('refuses unknown place ids before calling the model', async () => {
    const { tellStory } = await import('../server/story-server')
    await expect(tellStory({ stopIds: ['nope'] }, (() => { throw new Error('should not call') }) as never)).rejects.toThrow(/unknown/)
  })
})
