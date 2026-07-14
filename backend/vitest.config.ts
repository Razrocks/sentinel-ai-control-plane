import { defineConfig } from 'vitest/config'

/**
 * Vitest config for the backend.
 *
 * Scope: pure-logic unit tests only. Anything that touches Prisma or the
 * Anthropic SDK is deliberately excluded — those paths are covered by
 * `backend/eval/` (real model runs against golden inputs). This split
 * keeps `npm test` fast (< 5s) and stable in CI.
 *
 * Node environment: skill runner, prompt render, reliability helpers,
 * validation logic — none of it needs a DOM.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // No globals — tests import { describe, it, expect } explicitly so
    // the file is portable across runners and grep-friendly.
    globals: false,
    // Keep test output focused on failures during CI runs.
    reporters: process.env.CI ? ['default'] : ['default'],
  },
})
