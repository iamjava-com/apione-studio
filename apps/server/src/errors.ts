/** Typed application errors; mapped to HTTP status by the Fastify error handler. */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

// The optional `code` is a specific, stable identifier (e.g. 'username_taken') the frontend maps
// to a localized string; it defaults to the coarse category. `message` stays English — a fallback
// for unmapped codes and for API consumers.
export class NotFoundError extends AppError {
  constructor(message: string, code = 'not_found', details?: unknown) {
    super(404, code, message, details);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, code = 'validation', details?: unknown) {
    super(400, code, message, details);
  }
}

/** 409 — conflict (optimistic-concurrency or a broken invariant). `details` carries context. */
export class ConflictError extends AppError {
  constructor(message: string, code = 'conflict', details?: unknown) {
    super(409, code, message, details);
  }
}
