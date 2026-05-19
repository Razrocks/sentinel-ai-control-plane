/**
 * Expectation evaluation: apply one assertion to a skill output.
 * Returns { pass, actual, reason } so the report can show what went wrong.
 */
import type { AssertionResult, Expectation } from './types.js'

/**
 * Walk a dotted path into a value. Supports object keys and numeric array
 * indices. Returns undefined for missing paths (caller decides what that means).
 */
function getPath(obj: unknown, path: string): unknown {
  if (!path) return obj
  const parts = path.split('.')
  let cur: unknown = obj
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined
    if (Array.isArray(cur)) {
      const idx = Number(p)
      if (!Number.isInteger(idx)) return undefined
      cur = cur[idx]
    } else if (typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[p]
    } else {
      return undefined
    }
  }
  return cur
}

export function applyExpectation(
  exp: Expectation,
  output: unknown,
  status: string,
): AssertionResult {
  const actual = exp.path ? getPath(output, exp.path) : output

  switch (exp.kind) {
    case 'status_is': {
      const pass = status === exp.value
      return {
        expectation: exp,
        pass,
        actual: status,
        reason: pass ? undefined : `status="${status}", expected "${String(exp.value)}"`,
      }
    }

    case 'has_field': {
      const pass = actual !== undefined && actual !== null
      return {
        expectation: exp,
        pass,
        actual,
        reason: pass ? undefined : `field "${exp.path}" missing or null`,
      }
    }

    case 'field_equals': {
      const pass = actual === exp.value
      return {
        expectation: exp,
        pass,
        actual,
        reason: pass ? undefined : `field "${exp.path}"=${JSON.stringify(actual)}, expected ${JSON.stringify(exp.value)}`,
      }
    }

    case 'field_in': {
      const allowed = (exp.value as unknown[]) ?? []
      const pass = allowed.includes(actual)
      return {
        expectation: exp,
        pass,
        actual,
        reason: pass ? undefined : `field "${exp.path}"=${JSON.stringify(actual)} not in [${allowed.map(String).join(', ')}]`,
      }
    }

    case 'field_min': {
      const n = typeof actual === 'number' ? actual : NaN
      const min = exp.value as number
      const pass = !Number.isNaN(n) && n >= min
      return {
        expectation: exp,
        pass,
        actual,
        reason: pass ? undefined : `field "${exp.path}"=${actual} < min ${min}`,
      }
    }

    case 'field_max': {
      const n = typeof actual === 'number' ? actual : NaN
      const max = exp.value as number
      const pass = !Number.isNaN(n) && n <= max
      return {
        expectation: exp,
        pass,
        actual,
        reason: pass ? undefined : `field "${exp.path}"=${actual} > max ${max}`,
      }
    }

    case 'field_contains': {
      const s = typeof actual === 'string' ? actual.toLowerCase() : ''
      const needle = String(exp.value ?? '').toLowerCase()
      const pass = s.includes(needle)
      return {
        expectation: exp,
        pass,
        actual: typeof actual === 'string' ? actual.slice(0, 80) : actual,
        reason: pass ? undefined : `field "${exp.path}" does not contain "${exp.value}"`,
      }
    }

    case 'field_length_min': {
      const len = Array.isArray(actual) ? actual.length : typeof actual === 'string' ? actual.length : -1
      const min = exp.value as number
      const pass = len >= 0 && len >= min
      return {
        expectation: exp,
        pass,
        actual: len >= 0 ? len : actual,
        reason: pass ? undefined : `field "${exp.path}".length=${len >= 0 ? len : 'N/A (not string or array)'} < min ${min}`,
      }
    }

    case 'field_length_max': {
      const len = Array.isArray(actual) ? actual.length : typeof actual === 'string' ? actual.length : -1
      const max = exp.value as number
      const pass = len >= 0 && len <= max
      return {
        expectation: exp,
        pass,
        actual: len >= 0 ? len : actual,
        reason: pass ? undefined : `field "${exp.path}".length=${len >= 0 ? len : 'N/A (not string or array)'} > max ${max}`,
      }
    }

    case 'no_violations': {
      // Runner already enforces this. If we got here with status=success, no violations occurred.
      const pass = status === 'success'
      return {
        expectation: exp,
        pass,
        actual: status,
        reason: pass ? undefined : `runner returned status=${status} (reference validator may have triggered)`,
      }
    }

    default:
      return {
        expectation: exp,
        pass: false,
        reason: `unknown expectation kind: ${(exp as { kind: string }).kind}`,
      }
  }
}
