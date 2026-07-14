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
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    reporters: ['default'],
    // Fork pool trips over jsdom's CJS-requiring css-color dep on
    // Node 22 + ESM. Switching to threads avoids the require(ESM) crash
    // without needing to swap the whole environment.
    pool: 'threads',
    server: {
      deps: {
        inline: [/@asamuzakjp\/css-color/, /jsdom/],
      },
    },
  },
})
