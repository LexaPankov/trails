// Copies the MediaPipe Tasks Vision wasm runtime from node_modules into public/ so the
// camera recognizer works offline and without a third-party CDN.
import { cpSync, existsSync, mkdirSync } from 'node:fs'
const src = 'node_modules/@mediapipe/tasks-vision/wasm'
const dst = 'public/mediapipe/wasm'
if (!existsSync(src)) { console.error('[TRAILS] @mediapipe/tasks-vision not installed'); process.exit(1) }
mkdirSync(dst, { recursive: true })
cpSync(src, dst, { recursive: true })
console.log('[TRAILS] copied MediaPipe wasm ->', dst)
