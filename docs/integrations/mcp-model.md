# MCP Model

Sentinel is an **MCP client**. It connects outward to one or more MCP servers (run by the integration owners) and consumes their tools and resources. Sentinel does not, in v1, expose its own MCP server.

This document is about *how* the connection works: the registry, the adapters, the lifecycle, the validation contract.

## The MCP layer (S12)

Lives in `backend/src/mcp/`:

```
mcp/
├── client.ts              # Connection registry + lifecycle manager
├── types.ts               # Shared types: McpAdapter, McpHealth, McpTool
├── servicenow.ts          # ServiceNow adapter
├── github.ts              # GitHub adapter
├── opa.ts                 # OPA adapter
└── tests/                 # Per-adapter test fixtures
```

## The McpAdapter interface

Every integration implements this contract:

```typescript
interface McpAdapter {
  name: string                    // unique slug, e.g. "servicenow"
  displayName: string             // for UI: "ServiceNow"

  connect(config: AdapterConfig): Promise<void>
  disconnect(): Promise<void>
  health(): Promise<McpHealth>    // { status: 'connected' | 'degraded' | 'disconnected', lastSync, latencyMs, error? }
  test(): Promise<TestResult>     // a minimal round-trip ping for the Settings UI

  // Tool surface — what this integration offers
  tools(): Promise<McpTool[]>     // the list of MCP tools available
  callTool<T>(name: string, args: unknown): Promise<T>
}
```

The adapter wraps the underlying MCP SDK client. When the integration target is not natively MCP (most enterprise systems aren't yet), the adapter implements MCP semantics on top of REST/GraphQL — but presents the same `McpAdapter` interface.

## Registry

`client.ts` holds a singleton `Map<string, McpAdapter>`. Adapters are registered at server boot:

```typescript
// backend/src/mcp/client.ts
const registry = new Map<string, McpAdapter>()

export function registerAdapter(adapter: McpAdapter) { registry.set(adapter.name, adapter) }
export function getAdapter(name: string): McpAdapter { /* throws if not found */ }
export function listAdapters(): McpAdapter[] { return [...registry.values()] }
export async function healthAll(): Promise<Record<string, McpHealth>> { /* fan-out */ }
```

## Lifecycle

```
boot
 │
 ├─ load config (env: SERVICENOW_MCP_URL, GITHUB_MCP_URL, OPA_MCP_URL, etc.)
 ├─ for each configured adapter:
 │     instantiate, register, connect (async, non-blocking)
 │
 └─ ready

runtime
 │
 ├─ services call getAdapter('servicenow').callTool('createTicket', {...})
 ├─ adapter validates args (Zod), calls SDK, validates response (Zod)
 ├─ on error: throw McpError with category (transient | permanent | auth)
 └─ services handle error per their needs

shutdown
 │
 └─ for each adapter: disconnect()
```

## Validation

Every tool call has a Zod schema for both input and output. The adapter validates:

```typescript
async callTool<T>(name: string, args: unknown): Promise<T> {
  const tool = this.tools.find(t => t.name === name)
  if (!tool) throw new McpError('unknown_tool', name)

  const inputValid = tool.inputSchema.safeParse(args)
  if (!inputValid.success) throw new McpError('invalid_input', inputValid.error)

  const raw = await this.sdkCall(name, inputValid.data)

  const outputValid = tool.outputSchema.safeParse(raw)
  if (!outputValid.success) throw new McpError('invalid_output', outputValid.error)

  return outputValid.data as T
}
```

If output validation fails, the call is treated as a failure, not as a "best-effort." This protects every downstream consumer from having to second-guess MCP responses.

## Per-adapter capability

### ServiceNow adapter

**Tools exposed (v1):**
- `getTicket(id)` → ticket with state, fields, comments.
- `updateTicket(id, fields)` → write back state transitions or comments.
- `searchTickets(query)` → for the related-changes correlation in incident triage.
- `getKbArticle(id)` → KB article content.
- `searchKbArticles(query)` → for triage matching.

**Webhook listener.** Sentinel exposes `POST /api/webhooks/servicenow` (signed) so ServiceNow can push ticket-create / ticket-update events. The adapter's `connect()` registers the webhook URL with ServiceNow.

### GitHub adapter

**Tools exposed:**
- `getPullRequest(repo, number)` → PR metadata.
- `getCiStatus(repo, sha)` → check runs aggregated.
- `getRepository(repo)` → default branch, owners, settings.
- `listChangedFiles(repo, sha)` → for blast-radius analysis.

No write tools in v1 (Sentinel does not comment on PRs).

### OPA adapter

**Tools exposed:**
- `listBundles()` → currently active bundles.
- `getBundle(id)` → bundle metadata + rule list.
- `evaluatePolicy(input)` → (v2) delegate evaluation to OPA. v1 evaluates locally.

OPA also exposes `bundleVersion()` and `lastSync()` for the health page.

## Where MCP is *called*

Only from service layer code. Specifically:

| Caller | Adapter | Reason |
|---|---|---|
| `services/blast-radius/discovery.ts` | github | Walking PR + CI dependencies |
| `services/incident-triage/correlator.ts` | servicenow, github | Related changes + KB articles |
| `services/policy-engine.ts` (sync routine) | opa | Bundle sync |
| `services/access-eval/provisioning.ts` | servicenow | Outbound access grant ticket |
| `services/audit.ts` | servicenow (optional) | Mirror critical audit events to ServiceNow comments |
| `routes/webhooks/servicenow.ts` | servicenow | Inbound webhook handling |

Skills do **not** call MCP. If a skill needs external data, the calling service fetches it first and passes it in the entity context.

## Failure handling

`McpError` has three categories:
- `transient` — network blip, 5xx, timeout. Retry with backoff inside the adapter (max 3); raise to caller after exhaustion.
- `permanent` — 400/404, schema mismatch, unknown tool. No retry; raise immediately.
- `auth` — 401/403. No retry; raise as auth-class error; admin alert.

Service callers decide:
- **Discovery / annotation** (blast-radius, KB matches): treat error as "data unavailable", continue with what's known. Audit the missing-data condition.
- **Source-of-truth** (ticket update on approval): error fails the parent operation. The approval still records (DB), but the ServiceNow update is queued for retry.
- **Policy bundle sync**: error keeps the cached bundle; admin sees stale-bundle warning.

## Why MCP at all (vs raw REST adapters)

Three reasons:

1. **Tool-shape uniformity.** Every integration speaks the same conceptual model — tools with input/output schemas. New integrations follow the same template; engineers don't relearn an SDK per integration.
2. **Future-proofing for agentic tool use.** When v2 introduces native tool-use (Anthropic function calling), MCP tools map 1:1. The agent layer can be granted tool access in a controlled way: the agent gets `read_*` tools, never `write_*`.
3. **Vendor independence.** ServiceNow REST API today, IBM Maximo tomorrow — both can be wrapped in adapters that present the same `McpAdapter` interface. Service callers don't change.

## Settings page integration

`GET /api/settings/integrations` returns:
```json
[
  { "name": "servicenow", "displayName": "ServiceNow", "status": "connected", "lastSync": "2026-04-27T10:14:00Z", "latencyMs": 124 },
  { "name": "github",     "displayName": "GitHub",     "status": "connected", "lastSync": "2026-04-27T10:13:00Z", "latencyMs": 87 },
  { "name": "opa",        "displayName": "OPA",        "status": "degraded",  "lastSync": "2026-04-27T09:32:00Z", "latencyMs": 240, "error": "bundle sync timeout" }
]
```

`POST /api/settings/integrations/:name/test` triggers `adapter.test()` and returns the result.

## What's not in v1

- **Sentinel as MCP server.** v2 may expose Sentinel's read APIs as MCP tools so external agents can query Sentinel state. Out of scope now.
- **Tool authorization at the agent level.** Agents in v1 don't directly call tools; they call skills, which run inside services. v2 may grant specific agents access to specific read-tools.
- **Bidirectional bundle sync.** Sentinel pulls OPA bundles in v1; it does not push policy edits back. Admins edit policy in OPA's own surface.
- **Custom MCP servers.** No plan to add admin-configurable MCP server URLs in v1; integrations are coded.
