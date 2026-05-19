/**
 * Prompt builders for the skills system.
 *
 * Composes context tiers (T1.a–T1.e, T2 extras, T4 audit slice, T5 temporal)
 * into stable, cacheable system-prompt fragments. The runner concatenates
 * the fragments a skill opts into; per-skill `buildPrompt` adds the entity
 * payload + task instructions.
 *
 * Cache discipline: order is deterministic so `prompt_hash` is stable for
 * the same (skill, input, context) tuple.
 */

import type {
  SkillContext,
  T1aIdentity,
  T1bPolicyBundle,
  T1cRoleConstraints,
  T1dOrgCatalog,
  T1eSkillRegistry,
  T2Context,
  T4Context,
  T5Context,
} from './types.js'

// ─── Defaults ───────────────────────────────────────────

export const DEFAULT_IDENTITY: T1aIdentity = {
  systemRole: 'sentinel',
  hardConstraints: [
    'You are an assistant for Sentinel, a policy-enforced operational control plane.',
    'You produce advisory output only. You never approve, deny, execute, grant access, or write to the database.',
    'Deterministic services apply your output. Audit records every state change.',
    'Never invent entity IDs, ticket numbers, or fields not present in your input.',
    'When asked to output JSON, output only the JSON object — no prose, no code fences.',
  ],
}

// ─── T1.a — identity ────────────────────────────────────

export function renderT1aIdentity(identity: T1aIdentity = DEFAULT_IDENTITY): string {
  return [
    '## Identity',
    ...identity.hardConstraints.map((c) => `- ${c}`),
  ].join('\n')
}

// ─── T1.b — policy bundle ───────────────────────────────

export function renderT1bPolicyBundle(bundle: T1bPolicyBundle): string {
  const lines: string[] = ['## Active Policy Bundle', `Bundle version: ${bundle.bundleVersion}`]

  if (bundle.rules.length === 0) {
    lines.push('No active rules.')
  } else {
    lines.push('Rules:')
    for (const r of bundle.rules) {
      lines.push(`- ${r.name} (${r.bundle}, scope=${r.scope}, decision=${r.decision}): ${r.description}`)
    }
  }

  if (bundle.activeFreezes.length > 0) {
    lines.push('Active freeze windows:')
    for (const f of bundle.activeFreezes) {
      lines.push(`- ${f.id} (${f.label}) ${f.startsAt} → ${f.endsAt}; affects: ${f.affectsServices.join(', ')}`)
    }
  } else {
    lines.push('No active freeze windows.')
  }

  return lines.join('\n')
}

// ─── T1.c — role constraints ────────────────────────────

export function renderT1cRoleConstraints(role: T1cRoleConstraints): string {
  return [
    '## Role Constraints (acting user)',
    `Role: ${role.label} — ${role.description}`,
    'Allowed:',
    ...role.allowed.map((a) => `- ${a}`),
    'Blocked:',
    ...role.blocked.map((b) => `- ${b}`),
  ].join('\n')
}

// ─── T1.d — org & service catalog ───────────────────────

export function renderT1dOrgCatalog(cat: T1dOrgCatalog, opts?: { servicesFilter?: string[] }): string {
  const lines: string[] = ['## Org & Service Catalog']

  // User directory — compact form
  lines.push('Users:')
  for (const u of cat.users) {
    const owns = u.systemsOwned.length > 0 ? ` owns=[${u.systemsOwned.join(', ')}]` : ''
    const mgr = u.managerId ? ` manager=${u.managerId}` : ''
    lines.push(`- ${u.id} ${u.name} <${u.email}> role=${u.role} team=${u.team}${mgr}${owns}`)
  }

  // Services — optionally filtered
  const serviceEntries = Object.entries(cat.services)
  const filtered = opts?.servicesFilter
    ? serviceEntries.filter(([name]) => opts.servicesFilter!.includes(name))
    : serviceEntries

  if (filtered.length > 0) {
    lines.push('Services:')
    for (const [name, s] of filtered) {
      const downstream = s.downstream.length > 0 ? ` downstream=[${s.downstream.join(', ')}]` : ''
      lines.push(`- ${name} team=${s.team} criticality=${s.criticality} owners=[${s.ownerUserIds.join(', ')}]${downstream}`)
    }
  }

  // Approver registry
  const approverEntries = Object.entries(cat.approverRegistry)
  if (approverEntries.length > 0) {
    lines.push('Approver roles:')
    for (const [role, ids] of approverEntries) {
      lines.push(`- ${role}: [${ids.join(', ')}]`)
    }
  }

  return lines.join('\n')
}

// ─── T1.e — skill registry meta ─────────────────────────

export function renderT1eSkillRegistry(reg: T1eSkillRegistry): string {
  const lines: string[] = ['## Available Skills (for reference only)']
  for (const s of reg.skills) {
    lines.push(`- ${s.name}: ${s.purpose}`)
  }
  return lines.join('\n')
}

// ─── T2 — entity extras ─────────────────────────────────

export function renderT2Context(t2: T2Context): string {
  const sections: string[] = []

  if (t2.recentDeploysOnService && t2.recentDeploysOnService.length > 0) {
    sections.push(
      '## Recent Deploys (last 7d)',
      ...t2.recentDeploysOnService.map((d) => `- ${d.ticketId} @ ${d.deployedAt} → ${d.result}`),
    )
  }

  if (t2.recentIncidentsOnService && t2.recentIncidentsOnService.length > 0) {
    sections.push(
      '## Recent Incidents (last 30d)',
      ...t2.recentIncidentsOnService.map(
        (i) => `- ${i.incidentId} root=${i.rootCauseCategory} resolved=${i.resolvedAt}`,
      ),
    )
  }

  if (t2.prSummaries && t2.prSummaries.length > 0) {
    sections.push(
      '## Linked PR Summaries',
      ...t2.prSummaries.map(
        (p) => `- ${p.url} "${p.title}" files=${p.filesChanged} +${p.additions}/-${p.deletions}`,
      ),
    )
  }

  if (t2.candidateKbArticles && t2.candidateKbArticles.length > 0) {
    sections.push(
      '## Candidate KB Articles',
      ...t2.candidateKbArticles.map((k) => `- ${k.id}: ${k.title} — ${k.snippet}`),
    )
  }

  if (t2.priorWorkNotes && t2.priorWorkNotes.length > 0) {
    sections.push(
      '## Prior Work Notes (most recent last)',
      ...t2.priorWorkNotes.map((n) => `- [${n.at}] ${n.author}: ${n.note}`),
    )
  }

  return sections.join('\n')
}

// ─── T4 — audit slice ───────────────────────────────────

export function renderT4Context(t4: T4Context): string {
  if (!t4.recentAuditEvents || t4.recentAuditEvents.length === 0) return ''
  return [
    '## Recent Audit Events',
    ...t4.recentAuditEvents.map(
      (e) => `- [${e.timestamp}] ${e.actor} ${e.action} on ${e.objectId} → ${e.result}`,
    ),
  ].join('\n')
}

// ─── T5 — temporal ──────────────────────────────────────

export function renderT5Context(t5: T5Context): string {
  const lines: string[] = ['## Temporal', `Now: ${t5.now}`]
  if (t5.activeFreezes && t5.activeFreezes.length > 0) {
    lines.push('Active freezes:')
    for (const f of t5.activeFreezes) {
      lines.push(`- ${f.id} (${f.label}) ends ${f.endsAt}`)
    }
  } else {
    lines.push('No active freezes.')
  }
  if (t5.notes) lines.push(`Notes: ${t5.notes}`)
  return lines.join('\n')
}

// ─── Composite: build the full system prompt ────────────

export interface SystemPromptOptions {
  /** Always include identity (T1.a). Default: true. */
  includeIdentity?: boolean
  /** Include the policy bundle if present in ctx. */
  includePolicy?: boolean
  /** Include role constraints if present. */
  includeRole?: boolean
  /** Include org catalog if present. */
  includeOrgCatalog?: boolean
  /** Optional service filter for the org catalog (reduces tokens). */
  orgCatalogServices?: string[]
  /** Include the skill registry if present. */
  includeSkillRegistry?: boolean
  /** Include T2 extras if present. */
  includeT2?: boolean
  /** Include T4 audit slice if present. */
  includeT4?: boolean
  /** Include T5 temporal block if present. */
  includeT5?: boolean
  /** Per-skill task description appended at the end. */
  taskInstructions?: string
}

/**
 * Cache breakpoint marker. Runner splits the system prompt on this to build
 * a 2-block array: [cached stable T1+task] + [non-cached dynamic T2/T4/T5].
 * Marker text never appears in any rendered tier so collisions are impossible.
 */
export const CACHE_BREAK_MARKER = '<<<SENTINEL_CACHE_BREAK>>>'

/**
 * Compose a system prompt by joining the requested context tiers.
 * Sections before CACHE_BREAK_MARKER are stable per skill (eligible for cache);
 * sections after vary per call (T2 entity extras, T4 audit slice, T5 temporal).
 *
 * Order (cached first, dynamic last):
 *   1. [cached]   T1.a identity
 *   2. [cached]   T1.b policy bundle
 *   3. [cached]   T1.c role constraints
 *   4. [cached]   T1.d org catalog
 *   5. [cached]   T1.e skill registry (if opted in)
 *   6. [cached]   Task instructions
 *   -- CACHE_BREAK_MARKER --
 *   7. [dynamic]  T2 entity extras
 *   8. [dynamic]  T4 audit slice
 *   9. [dynamic]  T5 temporal
 */
export function buildSystemPrompt(ctx: SkillContext, opts: SystemPromptOptions = {}): string {
  const cached: string[] = []
  const dynamic: string[] = []
  const {
    includeIdentity = true,
    includePolicy = true,
    includeRole = true,
    includeOrgCatalog = true,
    orgCatalogServices,
    includeSkillRegistry = false,
    includeT2 = true,
    includeT4 = true,
    includeT5 = true,
    taskInstructions,
  } = opts

  // ── CACHED HALF ─────────────────────────────────────
  if (includeIdentity) {
    cached.push(renderT1aIdentity(ctx.t1?.identity))
  }
  if (includePolicy && ctx.t1?.policyBundle) {
    cached.push(renderT1bPolicyBundle(ctx.t1.policyBundle))
  }
  if (includeRole && ctx.t1?.roleConstraints) {
    cached.push(renderT1cRoleConstraints(ctx.t1.roleConstraints))
  }
  if (includeOrgCatalog && ctx.t1?.orgCatalog) {
    cached.push(renderT1dOrgCatalog(ctx.t1.orgCatalog, { servicesFilter: orgCatalogServices }))
  }
  if (includeSkillRegistry && ctx.t1?.skillRegistry) {
    cached.push(renderT1eSkillRegistry(ctx.t1.skillRegistry))
  }
  if (taskInstructions) {
    cached.push('## Task', taskInstructions)
  }

  // ── DYNAMIC HALF ────────────────────────────────────
  if (includeT2 && ctx.t2) {
    const t2 = renderT2Context(ctx.t2)
    if (t2) dynamic.push(t2)
  }
  if (includeT4 && ctx.t4) {
    const t4 = renderT4Context(ctx.t4)
    if (t4) dynamic.push(t4)
  }
  if (includeT5 && ctx.t5) {
    dynamic.push(renderT5Context(ctx.t5))
  }

  const cachedJoined = cached.join('\n\n')
  const dynamicJoined = dynamic.join('\n\n')

  if (!dynamicJoined) return cachedJoined
  return `${cachedJoined}\n\n${CACHE_BREAK_MARKER}\n\n${dynamicJoined}`
}

/**
 * Split a prompt produced by `buildSystemPrompt` into its cached + dynamic
 * halves on the CACHE_BREAK_MARKER. Used by the runner to construct the
 * Anthropic system content array with cache_control on the first block.
 */
export function splitOnCacheBreak(systemPrompt: string): { cached: string; dynamic: string } {
  const idx = systemPrompt.indexOf(CACHE_BREAK_MARKER)
  if (idx === -1) return { cached: systemPrompt, dynamic: '' }
  const cached = systemPrompt.slice(0, idx).replace(/\n+$/, '')
  const dynamic = systemPrompt.slice(idx + CACHE_BREAK_MARKER.length).replace(/^\n+/, '')
  return { cached, dynamic }
}

// ─── User message helpers ───────────────────────────────

/**
 * Render the input payload as a fenced JSON block. The runner uses this for
 * the user message body. Strict-JSON outputs are easier when the input
 * is presented as JSON.
 */
export function renderInputAsJson(input: unknown): string {
  return [
    'Input payload (read-only — do NOT echo this back):',
    '```json',
    JSON.stringify(input, null, 2),
    '```',
    '',
    'Now produce a NEW JSON object as your output. The output JSON shape is defined in the [Task]',
    'section above — it has DIFFERENT fields from the input. Use the input as source material to',
    'compute the output fields the task asks for.',
    '',
    'Rules:',
    '- Output ONLY the JSON object. No prose before or after.',
    '- No markdown code fences (no ```).',
    '- No comments inside the JSON.',
    '- Include every field the task lists as required.',
  ].join('\n')
}
