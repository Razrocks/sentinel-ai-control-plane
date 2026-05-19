/**
 * Public surface of the skills system (Phase 8).
 *
 * Callers import from here:
 *   import { runSkill, runners, getSkill, listSkills } from '@/services/skills'
 *
 * Internal modules can still import the granular files (types.js, schemas.js,
 * registry.js, prompt.js, runner.js) when only one piece is needed.
 */

export type {
  SkillName,
  SkillKind,
  SkillSpec,
  SkillContext,
  T1aIdentity,
  T1bPolicyBundle,
  T1cRoleConstraints,
  T1dOrgCatalog,
  T1eSkillRegistry,
  T1Context,
  T2Context,
  T4Context,
  T5Context,
  RunnerStatus,
  RunnerResult,
  RunSkillOptions,
} from './types.js'

export { SKILL_NAMES } from './types.js'

export * from './schemas.js'

export {
  buildSystemPrompt,
  splitOnCacheBreak,
  CACHE_BREAK_MARKER,
  renderInputAsJson,
  renderT1aIdentity,
  renderT1bPolicyBundle,
  renderT1cRoleConstraints,
  renderT1dOrgCatalog,
  renderT1eSkillRegistry,
  renderT2Context,
  renderT4Context,
  renderT5Context,
  DEFAULT_IDENTITY,
} from './prompt.js'

export { getSkill, listSkills, hasSkill } from './registry.js'

export { runSkill, runners, isSkillRunnerConfigured } from './runner.js'

export { validateReferences, violationsAreBlocking } from './validate-references.js'
export type { ReferenceViolation } from './validate-references.js'
