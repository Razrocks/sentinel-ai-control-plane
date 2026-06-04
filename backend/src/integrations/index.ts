/**
 * Integration registry bootstrap.
 *
 * Importing this module runs the side-effecting `registerAdapter` calls
 * inside each provider's `adapter.ts`. Server.ts imports this file once
 * at boot so every adapter is in the registry before any webhook arrives
 * or any route handler asks `getAdapter(type)`.
 */

import './github/adapter.js'
// Phase 3 — additional providers slot in here as their adapters land.
// import './slack/adapter.js'
// import './linear/adapter.js'
// import './sentry/adapter.js'
// import './pagerduty/adapter.js'

// Re-export the public surface so callers can `import { ... } from '@/integrations'`.
export {
  registerAdapter,
  getAdapter,
  hasAdapter,
  listAdapters,
} from './_base/adapter.js'
export type {
  IntegrationAdapter,
  ConnectionTestResult,
  ScopeOption,
  WebhookRegistration,
  InboundEvent,
  EventResult,
} from './_base/adapter.js'
export {
  encrypt,
  decrypt,
  isEncryptionAvailable,
  maskCredential,
} from './_base/encryption.js'
