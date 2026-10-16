// Image embeddings with MediaPipe Tasks (MobileNetV3 image embedder, Apache-2.0), run fully in the browser.
// The wasm runtime and model are served from this app (public/), so no third-party CDN is needed.
import { FilesetResolver, ImageEmbedder } from '@mediapipe/tasks-vision'

const BASE = import.meta.env.BASE_URL
export const EMBED_MODEL = (import.meta.env.VITE_EMBED_MODEL as string | undefined) || 'mobilenet_v3_small'

let embedderP: Promise<ImageEmbedder> | null = null

export function loadEmbedder(model = EMBED_MODEL): Promise<ImageEmbedder> {
  if (!embedderP) {
    embedderP = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(`${new URL(BASE, location.href).href}mediapipe/wasm`)
      return ImageEmbedder.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${BASE}models/${model}.tflite`, delegate: 'CPU' },
        runningMode: 'IMAGE',
        l2Normalize: true,
        quantize: false,
      })
    })()
    embedderP.catch(() => { embedderP = null })
  }
  return embedderP
}

export function embed(e: ImageEmbedder, src: HTMLCanvasElement | HTMLImageElement): Float32Array {
  const r = e.embed(src)
  const v = r.embeddings[0].floatEmbedding
  if (!v) throw new Error('embedder returned no float embedding')
  return Float32Array.from(v)
}
