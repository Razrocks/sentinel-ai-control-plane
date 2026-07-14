import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ApiError, apiFetch, setTokenGetter } from './api'

// The API layer wraps every backend call. If ApiError.body extraction
// or the 412 handling regresses, every mutation hook downstream sees
// wrong error shapes and toast/retry logic silently misbehaves.

// Test fixture — a fake fetch that returns whatever the test staged.
type StagedResponse = {
  ok: boolean
  status: number
  statusText?: string
  body: string
  headers?: Record<string, string>
}

function stubFetch(stage: StagedResponse) {
  const fake = vi.fn(async () => {
    return {
      ok: stage.ok,
      status: stage.status,
      statusText: stage.statusText ?? '',
      text: async () => stage.body,
      json: async () => JSON.parse(stage.body),
      headers: {
        get: (name: string) =>
          stage.headers?.[name.toLowerCase()] ?? stage.headers?.[name] ?? null,
      },
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fake)
  return fake
}

describe('ApiError', () => {
  it('carries status + message + body + etag fields', () => {
    const err = new ApiError(412, 'stale', { currentVersion: 5 }, 'W/"5"')
    expect(err).toBeInstanceOf(Error)
    expect(err.status).toBe(412)
    expect(err.message).toBe('stale')
    expect(err.body).toEqual({ currentVersion: 5 })
    expect(err.etag).toBe('W/"5"')
    expect(err.name).toBe('ApiError')
  })

  it('body + etag are optional', () => {
    const err = new ApiError(500, 'boom')
    expect(err.body).toBeUndefined()
    expect(err.etag).toBeUndefined()
  })
})

describe('apiFetch', () => {
  beforeEach(() => {
    setTokenGetter(() => null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    setTokenGetter(() => null)
  })

  it('returns parsed JSON on 2xx', async () => {
    stubFetch({
      ok: true,
      status: 200,
      body: JSON.stringify({ hello: 'world' }),
    })
    await expect(apiFetch<{ hello: string }>('/anything')).resolves.toEqual({
      hello: 'world',
    })
  })

  it('throws ApiError on non-2xx with parsed JSON body', async () => {
    stubFetch({
      ok: false,
      status: 400,
      body: JSON.stringify({ message: 'bad payload', code: 'VALIDATION_ERROR' }),
    })
    await expect(apiFetch('/anything')).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      message: 'bad payload',
      body: { message: 'bad payload', code: 'VALIDATION_ERROR' },
    })
  })

  it('412 preserves currentVersion + expectedVersion on ApiError.body', async () => {
    stubFetch({
      ok: false,
      status: 412,
      body: JSON.stringify({
        message: 'stale',
        expectedVersion: 2,
        currentVersion: 5,
      }),
    })
    try {
      await apiFetch('/approvals/appr-1/decide')
      throw new Error('should not reach')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      const apiErr = err as ApiError
      expect(apiErr.status).toBe(412)
      expect(apiErr.body).toMatchObject({ expectedVersion: 2, currentVersion: 5 })
    }
  })

  it('surfaces the etag header on ApiError', async () => {
    stubFetch({
      ok: false,
      status: 412,
      body: JSON.stringify({ message: 'stale' }),
      headers: { etag: 'W/"7"' },
    })
    try {
      await apiFetch('/x')
    } catch (err) {
      expect((err as ApiError).etag).toBe('W/"7"')
    }
  })

  it('falls back to raw text when body is not JSON', async () => {
    stubFetch({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      body: 'nginx crashed',
    })
    await expect(apiFetch('/x')).rejects.toMatchObject({
      status: 502,
      message: 'nginx crashed',
      body: 'nginx crashed',
    })
  })

  it('sends Authorization header when a token getter returns a value', async () => {
    const fake = stubFetch({
      ok: true,
      status: 200,
      body: JSON.stringify({}),
    })
    setTokenGetter(() => 'token-abc')
    await apiFetch('/health')
    const call = fake.mock.calls[0]
    const init = call[1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer token-abc')
  })

  it('sets Content-Type only when a body is present', async () => {
    const fake = stubFetch({
      ok: true,
      status: 200,
      body: JSON.stringify({}),
    })
    // GET with no body → no content-type header.
    await apiFetch('/health', { method: 'GET' })
    const getHeaders = (fake.mock.calls[0][1] as RequestInit).headers as Record<
      string,
      string
    >
    expect(getHeaders['Content-Type']).toBeUndefined()

    // POST with a body → content-type set.
    await apiFetch('/x', { method: 'POST', body: JSON.stringify({ a: 1 }) })
    const postHeaders = (fake.mock.calls[1][1] as RequestInit).headers as Record<
      string,
      string
    >
    expect(postHeaders['Content-Type']).toBe('application/json')
  })
})
