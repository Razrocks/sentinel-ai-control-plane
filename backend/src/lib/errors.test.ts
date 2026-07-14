import { describe, it, expect } from 'vitest'
import {
  AppError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
  PreconditionFailedError,
} from './errors.js'

// Sanity tests over the error hierarchy. All errors extend AppError so
// route handlers can catch AppError and use `.statusCode` + `.code`
// uniformly — regressions here break error-code translation everywhere.

describe('AppError', () => {
  it('carries statusCode + optional code and inherits from Error', () => {
    const err = new AppError(418, "I'm a teapot", 'TEAPOT')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(AppError)
    expect(err.statusCode).toBe(418)
    expect(err.message).toBe("I'm a teapot")
    expect(err.code).toBe('TEAPOT')
    expect(err.name).toBe('AppError')
  })

  it('code is optional', () => {
    const err = new AppError(500, 'boom')
    expect(err.code).toBeUndefined()
  })
})

describe('NotFoundError', () => {
  it('is 404 + NOT_FOUND with resource-shaped message', () => {
    const err = new NotFoundError('Approval', 'appr-001')
    expect(err.statusCode).toBe(404)
    expect(err.code).toBe('NOT_FOUND')
    expect(err.name).toBe('NotFoundError')
    expect(err.message).toContain('Approval')
    expect(err.message).toContain('appr-001')
    expect(err).toBeInstanceOf(AppError)
  })
})

describe('UnauthorizedError', () => {
  it('defaults to 401 UNAUTHORIZED and accepts custom message', () => {
    expect(new UnauthorizedError().statusCode).toBe(401)
    expect(new UnauthorizedError().code).toBe('UNAUTHORIZED')
    expect(new UnauthorizedError('token expired').message).toBe('token expired')
  })
})

describe('ForbiddenError', () => {
  it('is 403 FORBIDDEN', () => {
    const err = new ForbiddenError('nope')
    expect(err.statusCode).toBe(403)
    expect(err.code).toBe('FORBIDDEN')
    expect(err.name).toBe('ForbiddenError')
  })
})

describe('ValidationError', () => {
  it('is 400 VALIDATION_ERROR', () => {
    const err = new ValidationError('field X is required')
    expect(err.statusCode).toBe(400)
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err.message).toBe('field X is required')
  })
})

describe('PreconditionFailedError', () => {
  it('is 412 PRECONDITION_FAILED and exposes version fields', () => {
    const err = new PreconditionFailedError('Approval', 'appr-003', 2, 5)
    expect(err.statusCode).toBe(412)
    expect(err.code).toBe('PRECONDITION_FAILED')
    expect(err.name).toBe('PreconditionFailedError')
    expect(err.expectedVersion).toBe(2)
    expect(err.currentVersion).toBe(5)
  })

  it('message quotes both versions so the client can reason about the drift', () => {
    const err = new PreconditionFailedError('Change', 'CHG-1', 0, 7)
    expect(err.message).toMatch(/version 0/)
    expect(err.message).toMatch(/current is 7/)
  })
})
