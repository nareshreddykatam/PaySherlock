// Shared error taxonomy used across PaySherlock packages/apps so callers can
// distinguish failure classes (validation vs. auth/config vs. upstream vs.
// internal) without depending on any one package's specific error types.

export abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  readonly code = "VALIDATION_ERROR";
  readonly httpStatus = 400;
}

export class ConfigError extends AppError {
  readonly code = "CONFIG_ERROR";
  readonly httpStatus = 500;
}

export class NotFoundError extends AppError {
  readonly code = "NOT_FOUND";
  readonly httpStatus = 404;
}

export class UpstreamApiError extends AppError {
  readonly code = "UPSTREAM_API_ERROR";
  readonly httpStatus = 502;
}

export class SignatureVerificationError extends AppError {
  readonly code = "SIGNATURE_VERIFICATION_ERROR";
  readonly httpStatus = 401;
}

export class DatabaseError extends AppError {
  readonly code = "DATABASE_ERROR";
  readonly httpStatus = 500;
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
