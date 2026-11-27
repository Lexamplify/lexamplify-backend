import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the built template works under any GitHub Pages subpath.
  base: './',
  plugins: [react()],
  build: {
    // Split third-party libraries into their own stable chunk. Vendor code
    // changes far less often than app code, so a content-hashed vendor bundle
    // stays cached in browsers/CDN across deploys — repeat visitors only
    // re-download the (small) app chunks that actually changed.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) {
              return 'react-vendor';
            }
            return 'vendor';
          }
          return undefined;
        },
      },
    },
  },
  define: {
    'import.meta.env.VITE_BUILD_ID': JSON.stringify(process.env.VITE_BUILD_ID || `v9-${Date.now()}`),
  },
  server: {
    watch: { usePolling: true, interval: 300 },
    proxy: {
      // Same-origin cookie proxying: the browser only ever talks to
      // :5173, so the JWT/CSRF cookies (SameSite=Strict) are always
      // first-party from its perspective — Vite forwards to Flask
      // server-side, which is not a "site" the SameSite policy sees.
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:5000',
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
