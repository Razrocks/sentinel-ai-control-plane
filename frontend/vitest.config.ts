import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

/**
 * Vitest config for the frontend.
 *
 * Scope: pure-logic + hook + component unit tests that don't need the
 * real backend. Tests that need HTTP round-trips or real DOM
 * interactions belong in an e2e layer (Playwright), not here.
 *
 * jsdom environment: enough for @testing-library/react's render loop
 * and lets us test components that touch document / window without
 * spinning up a browser.
 *
 * Shared aliases: mirrors `vite.config.ts` so `@/lib/utils` resolves
 * during tests the same way it does in the app.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    // happy-dom instead of jsdom — jsdom 27 pulls in a css-color dep
    // that require()s an ESM file, which crashes vitest workers on
    // Node 22. happy-dom is smaller + faster + ESM-clean and covers the
    // DOM surface our tests actually touch.
    environment: 'happy-dom',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    reporters: ['default'],
  },
})
