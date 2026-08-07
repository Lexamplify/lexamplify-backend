import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Same-origin cookie proxying: the browser only ever talks to
      // :5173, so the JWT/CSRF cookies (SameSite=Strict) are always
      // first-party from its perspective — Vite forwards to Flask
      // server-side, which is not a "site" the SameSite policy sees.
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
  },
})
