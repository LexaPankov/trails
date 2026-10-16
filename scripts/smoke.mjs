// End-to-end smoke test in headless Chromium: walks through every screen, fails on runtime errors,
// and saves screenshots to docs/screenshots. Start `npm run dev` first.
//   node scripts/smoke.mjs [--url http://localhost:5173]
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:5173'
mkdirSync('docs/screenshots', { recursive: true })
const browser = await chromium.launch()
const errors = []
const results = []
let current = ''
async function check(name, fn) {
  current = name
  try { await fn(); results.push(`PASS ${name}`) } catch (e) { results.push(`FAIL ${name}: ${e.message.split('\n')[0]}`) }
}
for (const [label, viewport] of [['desktop', { width: 1366, height: 860 }], ['mobile', { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${label} pageerror during "${current}": ${e.message}${process.env.SMOKE_STACK ? '\n' + e.stack : ''}`))
  page.on('console', (m) => { if (m.type() === 'error' && !/tile|Failed to load resource|ERR_|XNNPACK|valhalla|routing\.openstreetmap|cartocdn/i.test(m.text())) errors.push(`${label} console: ${m.text()}`) })
  const shot = (n) => page.screenshot({ path: `docs/screenshots/${label}-${n}.png` })
  await page.goto(url + '/#/')
  await check(`${label}: home renders`, async () => { await page.getByRole('heading', { name: /Every route has/ }).waitFor(); await page.waitForTimeout(700); await shot('1-home') })
  await check(`${label}: preset plans a route`, async () => {
    await page.getByRole('button', { name: /Ancient stones/ }).click()
    await page.getByRole('heading', { name: 'Your stops' }).waitFor({ timeout: 30000 })
    await page.waitForTimeout(800); await shot('2-route')
  })
  const ancient = await page.locator('.stop h4').allTextContents()
  await check(`${label}: different interests give different stops`, async () => {
    await page.goto(url + '/#/')
    await page.getByRole('button', { name: /Renaissance & Baroque/ }).click()
    await page.getByRole('heading', { name: 'Your stops' }).waitFor({ timeout: 30000 })
    const ren = await page.locator('.stop h4').allTextContents()
    results.push(`INFO ${label}: ancient=${JSON.stringify(ancient)} renaissance=${JSON.stringify(ren)}`)
    if (JSON.stringify(ren) === JSON.stringify(ancient)) throw new Error('same stops')
  })
  await check(`${label}: any address to any address`, async () => {
    await page.goto(url + '/#/')
    await page.getByRole('button', { name: /Station to Trastevere/ }).click()
    await page.getByRole('heading', { name: 'Your stops' }).waitFor({ timeout: 30000 })
    const n = await page.locator('.stop h4').count()
    results.push(`INFO ${label}: Termini -> Piazza Trilussa: ${n} stops ${JSON.stringify(await page.locator('.stop h4').allTextContents())}`)
    if (!n) throw new Error('no stops for an address-to-address walk')
    await shot('2c-anywhere')
    await page.goto(url + '/#/')
    const from = page.locator('#from')
    await from.fill('trevi')
    await page.getByRole('option', { name: /Trevi Fountain/ }).first().click()
    if (!(await from.inputValue()).includes('Trevi')) throw new Error('search did not select')
    await from.fill('xyz'); await page.getByRole('button', { name: /Pick on the map/ }).click()
    await page.locator('.modal-map .leaflet-container').click({ position: { x: 200, y: 150 } })
    await page.getByRole('button', { name: /Use this point/ }).click({ timeout: 10000 })
    if (!/Pin at|Via|Piazza|\w/.test(await from.inputValue())) throw new Error('map pick did not set a point')
    await page.getByRole('button', { name: /Renaissance & Baroque/ }).click()
    await page.getByRole('heading', { name: 'Your stops' }).waitFor({ timeout: 30000 })
  })
  await check(`${label}: storyteller writes a grounded story`, async () => {
    await page.getByRole('button', { name: /Tell me the story/ }).click()
    await page.locator('.story-title').waitFor({ timeout: 60000 })
    const badge = await page.locator('.story-card .badge').first().innerText()
    results.push(`INFO ${label}: story by "${badge}", ${await page.locator('.story-text').count()} paragraphs`)
    await page.locator('.story-card').scrollIntoViewIfNeeded(); await shot('2b-story')
  })
  await check(`${label}: trade-off and thumbs feedback`, async () => {
    const t = await page.locator('.tradeoff').innerText()
    results.push(`INFO ${label}: trade-off "${t.replace(/\s+/g, ' ').slice(0, 140)}"`)
    if (!/Fastest walk/.test(t) || !/TRAILS walk/.test(t) || !/chosen for you/.test(t)) throw new Error('trade-off card missing')
    await page.getByRole('button', { name: /^More like / }).first().click()
    const note = await page.locator('.taste-note').innerText()
    if (!/↑/.test(note)) throw new Error('taste change not shown: ' + note)
    await page.locator('.tradeoff').scrollIntoViewIfNeeded(); await shot('2d-tradeoff')
  })
  await check(`${label}: stop opens place details`, async () => {
    await page.locator('.stop h4 button').first().click()
    await page.getByRole('heading', { name: 'Sources' }).waitFor(); await shot('3-place')
  })
  await check(`${label}: navigation with simulated walk`, async () => {
    await page.goto(url + '/#/navigate')
    await page.getByRole('button', { name: /Audio guide on/ }).click() // keep the headless run silent
    await page.getByLabel('Simulation speed').selectOption('60')
    await page.getByRole('button', { name: /Play simulated walk/ }).click()
    await page.locator('.guide-card h4').waitFor({ timeout: 30000 })
    results.push(`INFO ${label}: walk-mode cue "${await page.locator('.guide-card h4').innerText()}"`)
    await shot('4-navigate')
    await page.getByRole('button', { name: /Pause simulated walk/ }).click()
  })
  await check(`${label}: camera demo recognises a held-out photo`, async () => {
    await page.goto(url + '/#/camera')
    await page.locator('.ar-label').waitFor({ timeout: 60000 })
    await page.waitForTimeout(500); await shot('5-camera')
    await page.locator('.ar-label').click()
    await page.getByRole('button', { name: /Learn more/ }).waitFor()
    await shot('6-camera-popup')
  })
  await check(`${label}: profile + about render`, async () => {
    await page.goto(url + '/#/profile'); await page.getByRole('heading', { name: 'What you love' }).waitFor(); await shot('7-profile')
    await page.goto(url + '/#/about'); await page.getByRole('heading', { name: /Sources, models/ }).waitFor()
  })
  await ctx.close()
}
await browser.close()
console.log(results.join('\n'))
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1) }
if (results.some((r) => r.startsWith('FAIL'))) process.exit(1)
console.log('smoke OK')
