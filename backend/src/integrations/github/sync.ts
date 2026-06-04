/**
 * GitHub → Sentinel state mappers.
 *
 * One PR == one Change row, plus an ExternalRef tying them together so
 * the UI can render "this Change is GitHub PR #42" and the agent layer
 * can look the other direction.
 *
 * The mapping is intentionally lossy: we don't replicate every PR field
 * into the Change schema. Anything the model needs but we don't have on
 * the Change row stays on the ExternalRef.meta blob.
 *
 * Re-runs are idempotent — the ExternalRef row is keyed on
 * (integrationId, externalKind, externalId) which gives us natural upsert
 * semantics.
 */

import { prisma } from '../../lib/prisma.js'
import type { Integration } from '@prisma/client'
import type { GitHubPullRequest } from './client.js'

/**
 * Mint a stable Sentinel ticket id for a GitHub PR. Format is intentional:
 * the `gh-` prefix lets a glance distinguish ingested-from-github vs
 * native Sentinel tickets, and keeping `repo` + `number` makes the id
 * human-debuggable.
 */
export function ticketIdFor(repoFullName: string, prNumber: number): string {
  // Replace `/` so the id is valid in a URL path without encoding.
  return `gh-${repoFullName.replace('/', '_')}-${prNumber}`
}

/**
 * Upsert a Change from a GitHub PR webhook. Idempotent: re-running with
 * the same PR updates the existing Change row.
 *
 * Sentinel fields that GitHub doesn't carry:
 *   - service: defaults to the repo name (post-MVP: configurable mapping
 *     under Integration.config.serviceMap[repo] → service)
 *   - ownerTeam: defaults to the GitHub owner login (org or user)
 *   - riskLevel: defaults to 'medium'; ChangeTriageAgent reclassifies
 *   - environment: defaults to 'production' (PRs against the default
 *     branch); refined post-MVP
 *   - rollbackPlan: false until a human ticks the box
 */
export async function upsertChangeFromPR(
  integration: Integration,
  repoFullName: string,
  pr: GitHubPullRequest,
): Promise<{ changeId: string; created: boolean }> {
  const ticketId = ticketIdFor(repoFullName, pr.number)
  const serviceMap = (integration.config as { serviceMap?: Record<string, string> })?.serviceMap ?? {}
  const service = serviceMap[repoFullName] ?? repoFullName.split('/')[1] ?? repoFullName
  const owner = pr.user.login
  const ownerTeam = repoFullName.split('/')[0]

  const status =
    pr.state === 'closed' && pr.merged ? 'deployed' :
    pr.state === 'closed' ? 'rolled_back' :
    pr.draft ? 'open' :
    'in_review'

  const existing = await prisma.change.findUnique({ where: { ticketId } })

  if (existing) {
    const updated = await prisma.change.update({
      where: { ticketId },
      data: {
        title: pr.title,
        description: pr.body ?? '',
        status,
        // linkedPRs is a string[] — accumulate uniquely so re-syncs don't
        // duplicate, and so manually-attached PRs survive a webhook update.
        linkedPRs: Array.from(new Set([...(existing.linkedPRs ?? []), pr.html_url])),
      },
    })
    return { changeId: updated.id, created: false }
  }

  const created = await prisma.change.create({
    data: {
      ticketId,
      title: pr.title,
      description: pr.body ?? '',
      owner,
      ownerTeam,
      service,
      environment: 'production',
      riskLevel: 'medium',
      status,
      approvalState: 'pending',
      policyDecision: 'escalate',
      linkedPRs: [pr.html_url],
      ciStatus: 'pending',
      maintenanceWindow: null,
      rollbackPlan: false,
    },
  })

  return { changeId: created.id, created: true }
}

/**
 * Record the cross-system link. Idempotent (composite unique index).
 */
export async function upsertExternalRef(
  integration: Integration,
  changeDbId: string,
  pr: GitHubPullRequest,
  repoFullName: string,
): Promise<void> {
  await prisma.externalRef.upsert({
    where: {
      integrationId_externalKind_externalId: {
        integrationId: integration.id,
        externalKind: 'github_pr',
        externalId: `${repoFullName}#${pr.number}`,
      },
    },
    create: {
      integrationId: integration.id,
      sentinelType: 'change',
      sentinelId: changeDbId,
      externalKind: 'github_pr',
      externalId: `${repoFullName}#${pr.number}`,
      externalUrl: pr.html_url,
      meta: {
        prNumber: pr.number,
        repoFullName,
        author: pr.user.login,
        baseRef: pr.base.ref,
        headRef: pr.head.ref,
        headSha: pr.head.sha,
        changedFiles: pr.changed_files,
        additions: pr.additions,
        deletions: pr.deletions,
        labels: pr.labels.map((l) => l.name),
      },
    },
    update: {
      meta: {
        prNumber: pr.number,
        repoFullName,
        author: pr.user.login,
        baseRef: pr.base.ref,
        headRef: pr.head.ref,
        headSha: pr.head.sha,
        changedFiles: pr.changed_files,
        additions: pr.additions,
        deletions: pr.deletions,
        labels: pr.labels.map((l) => l.name),
      },
      externalUrl: pr.html_url,
    },
  })
}

/**
 * Translate a GitHub check_run.conclusion into the CIStatus enum.
 * `null` (still running) maps to 'pending'.
 */
export function checkRunToCiStatus(conclusion: string | null): 'passing' | 'failing' | 'pending' {
  if (!conclusion) return 'pending'
  if (conclusion === 'success' || conclusion === 'neutral' || conclusion === 'skipped') return 'passing'
  return 'failing'
}

/**
 * Find the Change a check_run belongs to via its head SHA. Returns null
 * when the SHA doesn't match any PR we've ingested (e.g. a CI run on
 * `main` after a non-PR push).
 */
export async function findChangeByHeadSha(integrationId: string, headSha: string) {
  const ref = await prisma.externalRef.findFirst({
    where: {
      integrationId,
      externalKind: 'github_pr',
      meta: { path: ['headSha'], equals: headSha },
    },
  })
  if (!ref) return null
  return prisma.change.findUnique({ where: { id: ref.sentinelId } })
}
