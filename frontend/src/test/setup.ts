/**
 * Vitest setup — runs once before every test file.
 *
 * - Registers `@testing-library/jest-dom` matchers so assertions like
 *   `expect(el).toBeInTheDocument()` work.
 * - Ensures `cleanup()` runs after each test to unmount React trees,
 *   so state doesn't leak across tests.
 */
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})
