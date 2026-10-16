import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base './' so the build works from any sub-path (GitHub Pages, Netlify, etc.)
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { host: true },
})
