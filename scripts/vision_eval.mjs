// Headless run of the in-app Vision lab (#/lab): builds public/vision/reference_index.json and
// public/vision/eval_report.json. Usage: start the dev server (npm run dev), then
//   node scripts/vision_eval.mjs [--url http://localhost:5173] [--model mobilenet_v3_large] [--no-write]
import { writeFileSync, mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const url = arg('--url', 'http://localhost:5173')
const model = arg('--model', 'mobilenet_v3_small')
const write = !process.argv.includes('--no-write')

const browser = await chromium.launch()
const page = await browser.newPage()
page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()) })
await page.goto(`${url}/#/lab?auto=1&model=${model}`)
await page.waitForFunction(() => window.__TRAILS_LAB__?.done, null, { timeout: 30 * 60 * 1000, polling: 2000 })
const res = await page.evaluate(() => window.__TRAILS_LAB__)
await browser.close()
if (res.error) { console.error(res.error); process.exit(1) }
console.log(JSON.stringify({ ...res.report, per_landmark: undefined }, null, 1))
mkdirSync('public/vision', { recursive: true })
writeFileSync(`docs/vision_eval_${model}.json`, JSON.stringify(res.report, null, 1))
if (write) {
  writeFileSync('public/vision/reference_index.json', JSON.stringify(res.index))
  writeFileSync('public/vision/eval_report.json', JSON.stringify(res.report, null, 1))
  console.log('wrote public/vision/reference_index.json and eval_report.json')
}
