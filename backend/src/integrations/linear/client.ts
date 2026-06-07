/**
 * Minimal Linear GraphQL client.
 *
 * Linear's REST is deprecated; everything lives at https://api.linear.app/graphql.
 * Auth: header `Authorization: <api_key>` (no `Bearer` prefix for personal
 * API keys — fine-grained PATs and OAuth tokens DO take Bearer).
 *
 * We send a handful of static queries — no codegen, no fragments. Each
 * function knows its query string and the shape it expects back.
 */

const API_URL = 'https://api.linear.app/graphql'
const DEFAULT_TIMEOUT_MS = 15_000
const USER_AGENT = 'Sentinel-Integration/1.0'

export class LinearApiError extends Error {
  constructor(
    public httpStatus: number,
    message: string,
    public graphqlErrors?: unknown,
  ) {
    super(message)
    this.name = 'LinearApiError'
  }
}

interface GraphQLResponse<T> {
  data?: T
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>
}

/**
 * Linear API key auth quirk: personal API keys (`lin_api_...`) take the raw
 * key in the `Authorization` header WITHOUT the `Bearer` prefix. OAuth
 * access tokens use the standard `Bearer <token>` form. We detect by
 * prefix so the operator can paste either.
 */
function authHeader(credential: string): string {
  return credential.startsWith('lin_api_') ? credential : `Bearer ${credential}`
}

async function gql<T>(
  credential: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: authHeader(credential),
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify({ query, variables }),
    })

    if (!res.ok) {
      throw new LinearApiError(res.status, `Linear API HTTP ${res.status}`)
    }

    const body = (await res.json()) as GraphQLResponse<T>
    if (body.errors && body.errors.length > 0) {
      throw new LinearApiError(200, body.errors.map((e) => e.message).join('; '), body.errors)
    }
    if (!body.data) {
      throw new LinearApiError(200, 'Linear API returned no data')
    }
    return body.data
  } finally {
    clearTimeout(timer)
  }
}

// ─── Public API ─────────────────────────────────────────

export interface LinearViewer {
  id: string
  name: string
  email: string
  organization: { id: string; name: string; urlKey: string }
}

/** Verify credential + return viewer + workspace info. */
export async function viewer(credential: string): Promise<LinearViewer> {
  const data = await gql<{ viewer: LinearViewer }>(
    credential,
    `query Viewer {
      viewer {
        id
        name
        email
        organization { id name urlKey }
      }
    }`,
  )
  return data.viewer
}

export interface LinearTeam {
  id: string
  key: string
  name: string
}

/**
 * List teams in the workspace. We cap at 100 — Linear's nodes are paged
 * but a single workspace > 100 teams is unusual; raise if it bites.
 */
export async function listTeams(credential: string): Promise<LinearTeam[]> {
  const data = await gql<{ teams: { nodes: LinearTeam[] } }>(
    credential,
    `query Teams { teams(first: 100) { nodes { id key name } } }`,
  )
  return data.teams.nodes
}

export interface LinearWebhook {
  id: string
  enabled: boolean
  url: string
  resourceTypes: string[]
}

/**
 * Create a per-team webhook. Linear's WebhookCreateInput requires either
 * `teamId` (team-scoped) OR `allPublicTeams: true` (workspace-wide). We
 * use `teamId` so the operator's "select teams" wizard choice maps 1:1
 * to actual subscriptions — selecting fewer teams means literally fewer
 * inbound events.
 */
export async function createWebhook(
  credential: string,
  url: string,
  secret: string,
  teamId: string,
): Promise<LinearWebhook> {
  const data = await gql<{ webhookCreate: { success: boolean; webhook: LinearWebhook } }>(
    credential,
    `mutation WebhookCreate($input: WebhookCreateInput!) {
      webhookCreate(input: $input) {
        success
        webhook { id enabled url resourceTypes }
      }
    }`,
    {
      input: {
        url,
        secret,
        resourceTypes: ['Issue', 'Comment', 'IssueLabel'],
        enabled: true,
        label: 'Sentinel',
        teamId,
      },
    },
  )
  if (!data.webhookCreate.success) {
    throw new LinearApiError(200, 'Linear refused to create webhook')
  }
  return data.webhookCreate.webhook
}

export async function deleteWebhook(credential: string, webhookId: string): Promise<void> {
  try {
    await gql<{ webhookDelete: { success: boolean } }>(
      credential,
      `mutation WebhookDelete($id: String!) {
        webhookDelete(id: $id) { success }
      }`,
      { id: webhookId },
    )
  } catch (err) {
    // 404 / "not found" on delete = idempotent success.
    if (err instanceof LinearApiError && /not found/i.test(err.message)) return
    throw err
  }
}
