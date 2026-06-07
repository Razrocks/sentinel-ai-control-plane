/**
 * Minimal Sentry API client.
 *
 * Sentry's auth model: an "Internal Integration" mints a single auth
 * token (`sntrys_...`) plus a client-secret pair used to sign outbound
 * webhooks. The operator copies both into Sentinel; we only need the
 * auth token for read-side API calls (test connection, list projects).
 *
 * Docs: https://docs.sentry.io/api/
 */

const API_BASE = 'https://sentry.io/api/0'
const DEFAULT_TIMEOUT_MS = 15_000
const USER_AGENT = 'Sentinel-Integration/1.0'

export class SentryApiError extends Error {
  constructor(
    public httpStatus: number,
    message: string,
  ) {
    super(message)
    this.name = 'SentryApiError'
  }
}

interface SentryRateContext {
  remaining: number
  resetAt: string
}

async function sentryFetch<T>(
  path: string,
  token: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<{ data: T; rate?: SentryRateContext }> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...rest,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': USER_AGENT,
        ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
        ...rest.headers,
      },
    })

    if (!res.ok) {
      let detail = `Sentry API HTTP ${res.status}`
      try {
        const errBody = (await res.json()) as { detail?: string }
        if (errBody.detail) detail = errBody.detail
      } catch {
        // body wasn't JSON
      }
      throw new SentryApiError(res.status, detail)
    }

    const remainingHeader = res.headers.get('x-sentry-rate-limit-remaining')
    const resetHeader = res.headers.get('x-sentry-rate-limit-reset')
    const rate: SentryRateContext | undefined =
      remainingHeader && resetHeader
        ? {
            remaining: Number(remainingHeader),
            resetAt: new Date(Number(resetHeader) * 1000).toISOString(),
          }
        : undefined

    const data = (await res.json()) as T
    return { data, rate }
  } finally {
    clearTimeout(timer)
  }
}

// ─── Public API ─────────────────────────────────────────

export interface SentryOrganization {
  id: string
  slug: string
  name: string
}

export interface SentryProject {
  id: string
  slug: string
  name: string
  organization: SentryOrganization
}

/**
 * List ALL projects the token can access. Each project embeds its org —
 * we pull the org from there because Internal Integration tokens don't
 * surface in `/organizations/` (that endpoint is for user tokens).
 *
 * Up to 500 projects (5 pages × 100) — wizard scope-picker bound.
 */
export async function listAllProjects(token: string): Promise<SentryProject[]> {
  const PER_PAGE = 100
  const MAX_PAGES = 5
  const all: SentryProject[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data } = await sentryFetch<SentryProject[]>(
      `/projects/?cursor=${(page - 1) * PER_PAGE}:0:0`,
      token,
    )
    all.push(...data)
    if (data.length < PER_PAGE) break
  }
  return all
}

/**
 * Identify the token's organization via the first reachable project.
 * Returns null if the token has no project access (misconfigured
 * Internal Integration without project-read scope).
 */
export async function identifyOrg(token: string): Promise<SentryOrganization | null> {
  const projects = await listAllProjects(token)
  if (projects.length === 0) return null
  return projects[0].organization
}
