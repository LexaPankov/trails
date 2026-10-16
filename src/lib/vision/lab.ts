// Vision lab: builds the reference index from bundled reference photos, calibrates the decision
// threshold on reference photos only, and evaluates on held-out test photos + unrelated landmarks.
// Run in the browser (#/lab) or headless via scripts/vision_eval.mjs. Reports only measured numbers.
import { IMAGES, PLACE_BY_ID } from '../data'
import { embed, loadEmbedder } from './embedder'
import { decide, encodeVec, landmarkScores, Recognizer, type RefEntry, type ReferenceIndexFile } from './recognizer'

const BASE = import.meta.env.BASE_URL

function loadImg(file: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image()
    im.onload = () => res(im)
    im.onerror = () => rej(new Error(`image failed: ${file}`))
    im.src = BASE + file
  })
}

function crop(im: HTMLImageElement, f: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  const w = im.naturalWidth * f, h = im.naturalHeight * f
  c.width = Math.round(w); c.height = Math.round(h)
  c.getContext('2d')!.drawImage(im, (im.naturalWidth - w) / 2, (im.naturalHeight - h) / 2, w, h, 0, 0, c.width, c.height)
  return c
}

export interface LabReport {
  model: string
  created: string
  landmarks: number
  reference_images: number
  index_vectors: number
  calibration: { method: string; threshold: number; margin: number; loo_known: number; cal_negatives: number; loo_accept_correct: number; cal_negative_false_accept: number }
  test: {
    known_images: number
    top1_accuracy: number
    recognized_correct: number
    recognized_wrong: number
    abstained: number
    negatives: number
    negative_false_accept: number
    with_geo_filter_2km: { top1_accuracy: number; recognized_correct: number; recognized_wrong: number }
    mean_ms_per_image: number
  }
  per_landmark: Record<string, { test: number; top1: number; recognized: number }>
  confusions: { truth: string; predicted: string; score: number }[]
}

export async function runLab(model: string, log: (s: string) => void): Promise<{ index: ReferenceIndexFile; report: LabReport }> {
  log(`Loading embedder ${model}…`)
  const emb = await loadEmbedder(model)
  const refs: RefEntry[] = []
  const lm = IMAGES.landmarks
  const ids = Object.keys(lm).filter((id) => PLACE_BY_ID[id])
  let nref = 0
  for (const id of ids) {
    for (const im of lm[id].filter((i) => i.split === 'reference')) {
      const img = await loadImg(im.file)
      refs.push({ placeId: id, file: im.file, vec: embed(emb, img) })
      refs.push({ placeId: id, file: im.file, vec: embed(emb, crop(img, 0.75)) })
      nref++
    }
    log(`Indexed ${id}`)
  }

  // ---- calibration: leave-one-image-out on reference photos + half of the unrelated photos
  const negs = IMAGES.unknown_negatives
  const calNeg = negs.filter((_, i) => i % 2 === 0)
  const testNeg = negs.filter((_, i) => i % 2 === 1)
  const loo: { truth: string; best: number; second: number; pred: string }[] = []
  for (const r of refs.filter((_, i) => i % 2 === 0)) {
    const sc = landmarkScores(r.vec, refs.filter((x) => x.file !== r.file))
    const ranked = [...sc.entries()].sort((a, b) => b[1] - a[1])
    loo.push({ truth: r.placeId, pred: ranked[0][0], best: ranked[0][1], second: ranked[1]?.[1] ?? -1 })
  }
  const negCal: { best: number; second: number }[] = []
  for (const n of calNeg) {
    const v = embed(emb, await loadImg(n.file))
    const ranked = [...landmarkScores(v, refs).values()].sort((a, b) => b - a)
    negCal.push({ best: ranked[0], second: ranked[1] })
  }
  let best = { t: 0.5, m: 0.02, objective: -Infinity, acc: 0, fa: 1 }
  for (let t = 0.3; t <= 0.95; t += 0.01) {
    for (const m of [0, 0.01, 0.02, 0.03, 0.04, 0.06]) {
      const acc = loo.filter((x) => x.best >= t && x.best - x.second >= m && x.pred === x.truth).length / loo.length
      const wrong = loo.filter((x) => x.best >= t && x.best - x.second >= m && x.pred !== x.truth).length / loo.length
      const fa = negCal.filter((x) => x.best >= t && x.best - x.second >= m).length / Math.max(1, negCal.length)
      // favour correct recognitions; false accepts (wrong landmark or non-landmark) cost three times more
      const objective = acc - 3 * wrong - 3 * fa
      if (objective > best.objective) best = { t: +t.toFixed(2), m, objective, acc, fa }
    }
  }
  log(`Calibrated threshold ${best.t}, margin ${best.m}`)

  const index: ReferenceIndexFile = {
    format: 'trails-vision-index/v1', model, dim: refs[0].vec.length, created: new Date().toISOString(),
    threshold: best.t, margin: best.m,
    entries: refs.map((r) => ({ p: r.placeId, f: r.file, q: encodeVec(r.vec) })),
  }

  // ---- test: held-out photos through the same recogniser the camera uses (quantised index, crops)
  const rec = new Recognizer(index, (c) => embed(emb, c))
  const per: LabReport['per_landmark'] = {}
  const confusions: LabReport['confusions'] = []
  let n = 0, top1 = 0, ok = 0, wrong = 0, abst = 0, ms = 0
  let gTop1 = 0, gOk = 0, gWrong = 0
  for (const id of ids) {
    per[id] = { test: 0, top1: 0, recognized: 0 }
    for (const im of lm[id].filter((i) => i.split === 'test')) {
      const img = await loadImg(im.file)
      const r = rec.recognize(img, img.naturalWidth, img.naturalHeight)
      const p = PLACE_BY_ID[id]
      const g = rec.recognize(img, img.naturalWidth, img.naturalHeight, { near: p, radiusM: 2000 })
      n++; per[id].test++; ms += r.ms
      if (r.best?.placeId === id) { top1++; per[id].top1++ }
      if (r.status === 'recognized') {
        if (r.best?.placeId === id) { ok++; per[id].recognized++ } else { wrong++; confusions.push({ truth: id, predicted: r.best!.placeId, score: +r.best!.score.toFixed(3) }) }
      } else abst++
      if (g.best?.placeId === id) gTop1++
      if (g.status === 'recognized') { if (g.best?.placeId === id) gOk++; else gWrong++ }
    }
    log(`Tested ${id}`)
  }
  let fa = 0
  for (const nimg of testNeg) {
    const img = await loadImg(nimg.file)
    const r = rec.recognize(img, img.naturalWidth, img.naturalHeight)
    if (r.status === 'recognized') fa++
  }
  const rd = (x: number) => +x.toFixed(3)
  const report: LabReport = {
    model, created: index.created, landmarks: ids.length, reference_images: nref, index_vectors: refs.length,
    calibration: {
      method: 'grid search on leave-one-image-out reference photos + 50% of unrelated GLDv2 photos; objective = correct - 3*wrong - 3*false_accept',
      threshold: best.t, margin: best.m, loo_known: loo.length, cal_negatives: negCal.length,
      loo_accept_correct: rd(best.acc), cal_negative_false_accept: rd(best.fa),
    },
    test: {
      known_images: n, top1_accuracy: rd(top1 / n), recognized_correct: rd(ok / n), recognized_wrong: rd(wrong / n), abstained: rd(abst / n),
      negatives: testNeg.length, negative_false_accept: rd(fa / Math.max(1, testNeg.length)),
      with_geo_filter_2km: { top1_accuracy: rd(gTop1 / n), recognized_correct: rd(gOk / n), recognized_wrong: rd(gWrong / n) },
      mean_ms_per_image: Math.round(ms / n),
    },
    per_landmark: per, confusions,
  }
  log('Done')
  return { index, report }
}

export { decide }
