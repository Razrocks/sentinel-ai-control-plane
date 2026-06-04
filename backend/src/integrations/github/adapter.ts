/**
 * GitHubAdapter — implements the IntegrationAdapter contract for GitHub.
 *
 * Auth: classic Personal Access Token (PAT). Fine-grained PATs also work
 * because we never do org-admin-level ops; for now we leave GitHub Apps
 * (multi-account, per-install perms) to a future iteration.
 *
 * Webhook subscription: pull_request, pull_request_review, check_run, push.
 * Push events are filtered to default-branch only at handler time.
 *
 * Lifecycle:
 *   - testConnection      → GET /user
 *   - listScopes          → GET /user/repos (up to 300)
 *   - registerWebhook     → POST /repos/:owner/:repo/hooks per selected repo
 *   - handleEvent         → dispatch by X-GitHub-Event header
 *
 * No retry logic here — the route layer's HMAC + dedup handle transport;
 * provider errors propagate to the adapter caller which records them in
 * Integration.lastError.
 */

import { randomBytes } from 'node:crypto'
import type { Integration } from '@prisma/client'
import {
  type IntegrationAdapter,
  type ConnectionTestResult,
  type ScopeOption,
  type WebhookRegistration,
  type InboundEvent,
  type EventResult,
  registerAdapter,
} from '../_base/adapter.js'
import {
  getAuthenticatedUser,
  listAccessibleRepos,
  createWebhook,
  deleteWebhook,
  getPullRequest,
  GitHubApiError,
  type GitHubPullRequest,
} from './client.js'
import { decrypt } from '../_base/encryption.js'
import {
  upsertChangeFromPR,
  upsertExternalRef,
  checkRunToCiStatus,
  findChangeByHeadSha,
} from './sync.js'
import { prisma } from '../../lib/prisma.js'

/**
 * Map a possibly-thrown error into a ConnectionTestResult. Keeps
 * `testConnection` from throwing — it returns a structured result so the
 * wizard can render the reason without parsing exceptions.
 */
function errorToTestResult(err: unknown): ConnectionTestResult {
  if (err instanceof GitHubApiError) {
    if (err.status === 401) {
      return { ok: false, errorMessage: 'GitHub rejected the token (401). Check token validity and scopes.' }
    }
    if (err.status === 403) {
      return {
        ok: false,
        errorMessage:
          'GitHub returned 403. Token may lack required scopes (need: repo, admin:repo_hook).',
      }
    }
    return { ok: false, errorMessage: `GitHub API error: ${err.message}` }
  }
  return { ok: false, errorMessage: err instanceof Error ? err.message : String(err) }
}

export const githubAdapter: IntegrationAdapter = {
  type: 'github',

  async testConnection(credential: string): Promise<ConnectionTestResult> {
    try {
      const { data: user, rateLimit } = await getAuthenticatedUser(credential)
      return {
        ok: true,
        identity: `@${user.login}`,
        rateLimit: { remaining: rateLimit.remaining, resetAt: rateLimit.resetAt },
      }
    } catch (err) {
      return errorToTestResult(err)
    }
  },

  async listScopes(_integration: Integration, credential: string): Promise<ScopeOption[]> {
    const { repos } = await listAccessibleRepos(credential)
    return repos.map((r) => ({
      id: r.full_name,
      label: r.full_name,
      meta: {
        private: r.private,
        defaultBranch: r.default_branch,
        ownerType: r.owner.type,
        canAdmin: r.permissions?.admin ?? false,
      },
    }))
  },

  async registerWebhook(
    _integration: Integration,
    credential: string,
    deliveryUrl: string,
    scopeId: string,
  ): Promise<WebhookRegistration> {
    const [owner, repo] = scopeId.split('/')
    if (!owner || !repo) {
      throw new Error(`scopeId must be "owner/repo"; got "${scopeId}"`)
    }
    // Generate a strong per-repo webhook secret. We surface it via the
    // returned registration so the route layer encrypts + saves it on
    // the Integration row. The plaintext never travels to the client.
    const sharedSecret = randomBytes(32).toString('hex')
    const hook = await createWebhook(credential, owner, repo, deliveryUrl, sharedSecret)
    return {
      providerWebhookId: String(hook.id),
      deliveryUrl,
      sharedSecret,
    }
  },

  async unregisterWebhook(
    _integration: Integration,
    credential: string,
    providerWebhookId: string,
  ): Promise<void> {
    // Without the owner/repo we can't call DELETE, so the route layer
    // passes us a composite id `owner/repo:hookId`. Parse defensively.
    const colon = providerWebhookId.lastIndexOf(':')
    if (colon === -1) return
    const ownerRepo = providerWebhookId.slice(0, colon)
    const hookId = Number(providerWebhookId.slice(colon + 1))
    const [owner, repo] = ownerRepo.split('/')
    if (!owner || !repo || !Number.isFinite(hookId)) return
    await deleteWebhook(credential, owner, repo, hookId)
  },

  async handleEvent(integration: Integration, event: InboundEvent): Promise<EventResult> {
    // GitHub event type lives in the X-GitHub-Event header (already
    // captured by the router into event.eventType).
    switch (event.eventType) {
      case 'ping':
        // Sent once when GitHub first activates the webhook. No-op success
        // so the router records it as a healthy ingest.
        return { result: 'processed' }

      case 'pull_request':
        return handlePullRequest(integration, event)

      case 'pull_request_review':
        return handlePullRequestReview(integration, event)

      case 'check_run':
        return handleCheckRun(integration, event)

      case 'push':
        return handlePush(integration, event)

      default:
        // Anything we didn't ask for, ignore silently. We *did* subscribe
        // only to the four above, but providers occasionally send
        // installation/marketplace events that don't belong to a repo.
        return { result: 'skipped' }
    }
  },
}

// ─── pull_request handler ───────────────────────────────

interface PullRequestEventBody {
  action: string
  number: number
  pull_request: GitHubPullRequest
  repository: { full_name: string }
}

async function handlePullRequest(integration: Integration, event: InboundEvent): Promise<EventResult> {
  const body = event.body as PullRequestEventBody
  // Only act on lifecycle events that genuinely change Change state.
  // Skip: assigned, labeled, review_requested, etc.
  const trackedActions = ['opened', 'reopened', 'synchronize', 'closed', 'edited', 'ready_for_review']
  if (!trackedActions.includes(body.action)) {
    return { result: 'skipped' }
  }

  const repoFullName = body.repository.full_name
  const pr = body.pull_request

  const { changeId } = await upsertChangeFromPR(integration, repoFullName, pr)
  await upsertExternalRef(integration, changeId, pr, repoFullName)

  return {
    result: 'processed',
    sentinelObjectId: changeId,
    sentinelObjectType: 'change',
  }
}

// ─── pull_request_review handler ────────────────────────

interface PullRequestReviewEventBody {
  action: string
  review: { state: string; user: { login: string }; body: string | null }
  pull_request: { number: number; html_url: string; head: { sha: string } }
  repository: { full_name: string }
}

async function handlePullRequestReview(
  integration: Integration,
  event: InboundEvent,
): Promise<EventResult> {
  const body = event.body as PullRequestReviewEventBody
  if (body.action !== 'submitted') return { result: 'skipped' }

  // Find the Change for the PR's head SHA. If we don't have one yet
  // (review on a PR opened before this integration connected), skip.
  const change = await findChangeByHeadSha(integration.id, body.pull_request.head.sha)
  if (!change) return { result: 'skipped', errorMessage: 'no matching change for review' }

  // Record an audit event so the timeline shows external reviewers.
  await prisma.auditEvent.create({
    data: {
      timestamp: new Date(),
      actor: `${body.review.user.login} (github)`,
      action: `pr_review_${body.review.state}`,
      objectType: 'change',
      objectId: change.ticketId,
      objectTitle: change.title,
      result: 'success',
      policyRule: null,
      changeId: change.id,
      details: body.review.body ?? `${body.review.state} review`,
    },
  })

  return { result: 'processed', sentinelObjectId: change.id, sentinelObjectType: 'change' }
}

// ─── check_run handler ──────────────────────────────────

interface CheckRunEventBody {
  action: string
  check_run: {
    name: string
    status: string
    conclusion: string | null
    head_sha: string
  }
  repository: { full_name: string }
}

async function handleCheckRun(integration: Integration, event: InboundEvent): Promise<EventResult> {
  const body = event.body as CheckRunEventBody
  if (body.action !== 'completed') return { result: 'skipped' }

  const change = await findChangeByHeadSha(integration.id, body.check_run.head_sha)
  if (!change) return { result: 'skipped', errorMessage: 'no matching change for check_run' }

  const ciStatus = checkRunToCiStatus(body.check_run.conclusion)

  await prisma.change.update({
    where: { id: change.id },
    data: { ciStatus },
  })

  return { result: 'processed', sentinelObjectId: change.id, sentinelObjectType: 'change' }
}

// ─── push handler ───────────────────────────────────────

interface PushEventBody {
  ref: string
  repository: { full_name: string; default_branch: string }
  sender: { login: string }
  head_commit?: { id: string; message: string }
}

async function handlePush(integration: Integration, event: InboundEvent): Promise<EventResult> {
  const body = event.body as PushEventBody
  // Filter to default-branch pushes — every other push lives on a feature
  // branch attached to a PR we already handle.
  if (body.ref !== `refs/heads/${body.repository.default_branch}`) {
    return { result: 'skipped' }
  }

  // We don't auto-create a Change for a direct-to-main push; that's a
  // governance violation but tracked separately. Log to audit.
  await prisma.auditEvent.create({
    data: {
      timestamp: new Date(),
      actor: `${body.sender.login} (github)`,
      action: 'direct_push_to_default_branch',
      objectType: 'change',
      objectId: body.repository.full_name,
      objectTitle: `Direct push to ${body.repository.full_name}`,
      result: 'success',
      policyRule: null,
      details: body.head_commit?.message ?? `Direct push to ${body.repository.default_branch}`,
    },
  })
  return { result: 'processed' }
}

// ─── Mark as registered on module load ───────────────────

registerAdapter(githubAdapter)

// Re-export the credential decryption helper for the route layer's
// per-repo registration flow, which doesn't have to import _base directly.
export { decrypt as _decryptForRouteLayer }

// Reference-suppress unused imports we want available for future expansion.
void getPullRequest
