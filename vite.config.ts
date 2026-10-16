import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// TRAILS — Vite config. MediaPipe wasm files are copied to public/mediapipe by scripts/copy-mediapipe.mjs (predev/prebuild).
export default defineConfig({
  plugins: [react()],
  // /api goes to the story server (server/story-server.ts), which keeps the model key off the client
  server: { host: true, proxy: { '/api': process.env.STORY_SERVER_URL ?? 'http://localhost:8787' } },
  preview: { proxy: { '/api': process.env.STORY_SERVER_URL ?? 'http://localhost:8787' } },
  build: { chunkSizeWarningLimit: 1200 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
})
