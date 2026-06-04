/**
 * Minimal GitHub REST client.
 *
 * Wraps the few endpoints our adapter needs. We don't pull in @octokit/rest
 * because (a) we only need ~5 calls, (b) octokit's plugin system + auth
 * layer is more surface than this project warrants, (c) keeping the call
 * site small makes the retry/timeout posture explicit.
 *
 * Auth: every request sends `Authorization: token <pat>` (classic PAT) or
 * `Authorization: Bearer <pat>` (fine-grained PAT; GitHub accepts either
 * scheme transparently). Both are 40-byte hex prefixed with `ghp_` /
 * `github_pat_` — we don't parse them, just forward.
 *
 * Errors throw `GitHubApiError` with the HTTP status. Callers translate to
 * domain errors. Never log the PAT — `[REDACTED]` everywhere it might land.
 */

const API_BASE = 'https://api.github.com'
const DEFAULT_TIMEOUT_MS = 15_000
/** GitHub recommends a custom User-Agent identifying your integration. */
const USER_AGENT = 'Sentinel-Integration/1.0'

export class GitHubApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public responseBody?: unknown,
  ) {
    super(message)
    this.name = 'GitHubApiError'
  }
}

export interface GitHubUser {
  login: string
  id: number
  type: 'User' | 'Organization'
  name: string | null
  email: string | null
}

export interface GitHubRepo {
  id: number
  node_id: string
  name: string
  full_name: string
  private: boolean
  default_branch: string
  permissions?: { admin: boolean; push: boolean; pull: boolean }
  owner: { login: string; type: 'User' | 'Organization' }
}

export interface GitHubRateLimit {
  remaining: number
  limit: number
  resetAt: string
}

export interface GitHubHook {
  id: number
  name: string
  active: boolean
  events: string[]
  config: { url: string; content_type: string }
}

/**
 * One-shot HTTP wrapper. Sets all required headers, enforces a 15s
 * timeout, and turns non-2xx responses into GitHubApiError so the caller
 * doesn't need to handle status codes inline.
 */
async function ghFetch<T>(
  path: string,
  pat: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<{ data: T; rateLimit: GitHubRateLimit }> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...rest,
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': USER_AGENT,
        Authorization: `token ${pat}`,
        ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
        ...rest.headers,
      },
    })

    const rateLimit: GitHubRateLimit = {
      remaining: Number(res.headers.get('x-ratelimit-remaining') ?? '0'),
      limit: Number(res.headers.get('x-ratelimit-limit') ?? '0'),
      resetAt: new Date(Number(res.headers.get('x-ratelimit-reset') ?? '0') * 1000).toISOString(),
    }

    if (!res.ok) {
      // Parse JSON error if present, otherwise raw text. Never include the
      // PAT in error messages even if the request URL got reflected.
      let body: unknown
      try {
        body = await res.json()
      } catch {
        body = await res.text().catch(() => '')
      }
      const message =
        typeof body === 'object' && body && 'message' in body
          ? String((body as { message: unknown }).message)
          : `GitHub API ${res.status}`
      throw new GitHubApiError(res.status, message, body)
    }

    // 204 No Content returns nothing.
    const data = res.status === 204 ? (null as unknown as T) : ((await res.json()) as T)
    return { data, rateLimit }
  } finally {
    clearTimeout(timer)
  }
}

// ─── Public API ─────────────────────────────────────────

/**
 * Verify the PAT works and return the authenticated user.
 * Used by `testConnection` and as the entry point for the connect wizard.
 */
export async function getAuthenticatedUser(pat: string) {
  return ghFetch<GitHubUser>('/user', pat)
}

/**
 * List repos the PAT has access to. We page-walk because the wizard's
 * scope picker needs the full list (typical user: <100 repos; cap at 300
 * to bound latency and memory).
 */
export async function listAccessibleRepos(pat: string): Promise<{ repos: GitHubRepo[]; rateLimit: GitHubRateLimit }> {
  const PER_PAGE = 100
  const MAX_PAGES = 3 // 300 repos max — sane upper bound for the wizard

  const all: GitHubRepo[] = []
  let lastRateLimit: GitHubRateLimit = { remaining: 0, limit: 0, resetAt: new Date().toISOString() }

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, rateLimit } = await ghFetch<GitHubRepo[]>(
      `/user/repos?per_page=${PER_PAGE}&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
      pat,
    )
    lastRateLimit = rateLimit
    all.push(...data)
    if (data.length < PER_PAGE) break
  }

  return { repos: all, rateLimit: lastRateLimit }
}

/**
 * Register a webhook on a repo. Returns the webhook id so we can delete
 * it on disconnect.
 *
 * Events subscribed: pull_request, pull_request_review, check_run, push.
 * push is filtered to the default branch at the handler level — GitHub
 * doesn't support branch-filtered subscription for the `push` event.
 */
export async function createWebhook(
  pat: string,
  owner: string,
  repo: string,
  deliveryUrl: string,
  secret: string,
): Promise<GitHubHook> {
  const body = {
    name: 'web',
    active: true,
    events: ['pull_request', 'pull_request_review', 'check_run', 'push'],
    config: {
      url: deliveryUrl,
      content_type: 'json',
      secret,
      insecure_ssl: '0',
    },
  }
  const { data } = await ghFetch<GitHubHook>(`/repos/${owner}/${repo}/hooks`, pat, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return data
}

/**
 * Delete a previously-registered webhook. Best-effort: 404 means "already
 * gone" which is fine for our purposes (idempotent unregister).
 */
export async function deleteWebhook(pat: string, owner: string, repo: string, hookId: number): Promise<void> {
  try {
    await ghFetch<null>(`/repos/${owner}/${repo}/hooks/${hookId}`, pat, { method: 'DELETE' })
  } catch (err) {
    if (err instanceof GitHubApiError && err.status === 404) return
    throw err
  }
}

/**
 * Read a single pull request. Used when a webhook arrives so we can mirror
 * the latest state into the Change row.
 */
export async function getPullRequest(pat: string, owner: string, repo: string, number: number) {
  return ghFetch<GitHubPullRequest>(`/repos/${owner}/${repo}/pulls/${number}`, pat)
}

export interface GitHubPullRequest {
  id: number
  number: number
  state: 'open' | 'closed'
  title: string
  body: string | null
  html_url: string
  user: { login: string }
  base: { ref: string; sha: string }
  head: { ref: string; sha: string }
  merged: boolean
  merged_at: string | null
  draft: boolean
  changed_files: number
  additions: number
  deletions: number
  labels: Array<{ name: string }>
}
