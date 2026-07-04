/** Typed application errors with stable machine-readable codes + HTTP status. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  unauthorized: (msg = 'Authentication required') =>
    new AppError(401, 'unauthorized', msg),
  forbidden: (msg = 'You do not have permission to perform this action') =>
    new AppError(403, 'forbidden', msg),
  notFound: (msg = 'Resource not found') => new AppError(404, 'not_found', msg),
  badRequest: (msg = 'Invalid request', details?: unknown) =>
    new AppError(400, 'bad_request', msg, details),
  conflict: (msg = 'Resource already exists') => new AppError(409, 'conflict', msg),
  validation: (details: unknown) =>
    new AppError(422, 'validation_error', 'Request validation failed', details),
  rateLimited: (msg = 'Too many requests') => new AppError(429, 'rate_limited', msg),
  planLimit: (msg: string) => new AppError(402, 'plan_limit', msg),
  internal: (msg = 'Internal server error') => new AppError(500, 'internal_error', msg),
};
