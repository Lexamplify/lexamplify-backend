import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Split long-lived vendor code from app code so the app shell caches across deploys and
        // the entry bundle stays small. Editor libs (ProseMirror/TipTap/marked/dompurify) only
        // load on routes that use them.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\/]node_modules[\/](react|react-dom|react-router|react-router-dom|scheduler)[\/]/.test(id)) return 'vendor-react';
          if (/[\/]node_modules[\/](@tiptap|prosemirror-|marked|dompurify)/.test(id)) return 'vendor-editor';
          return undefined;
        },
      },
    },
  },
  define: {
    'import.meta.env.VITE_BUILD_ID': JSON.stringify(process.env.VITE_BUILD_ID || `v9-${Date.now()}`),
  },
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
