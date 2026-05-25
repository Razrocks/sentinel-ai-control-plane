export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(404, `${resource} with id '${id}' not found`, 'NOT_FOUND')
    this.name = 'NotFoundError'
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, message, 'UNAUTHORIZED')
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, message, 'FORBIDDEN')
    this.name = 'ForbiddenError'
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(400, message, 'VALIDATION_ERROR')
    this.name = 'ValidationError'
  }
}

/**
 * 412 Precondition Failed — optimistic concurrency mismatch.
 *
 * Raised when a mutation includes an `If-Match` header (or `expectedVersion`
 * field) that does not match the current resource version. Clients should
 * refetch the resource and let the user decide how to proceed.
 *
 * Carries `currentVersion` so the client can surface what actually changed.
 */
export class PreconditionFailedError extends AppError {
  constructor(
    resource: string,
    id: string,
    public expectedVersion: number,
    public currentVersion: number,
  ) {
    super(
      412,
      `${resource} '${id}' was modified by someone else (you sent version ${expectedVersion}, current is ${currentVersion}). Reload and retry.`,
      'PRECONDITION_FAILED',
    )
    this.name = 'PreconditionFailedError'
  }
}
