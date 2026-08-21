import { API_BASE_URL } from "./config";

/** Thrown for any failed API call — network failure, non-2xx response, or
 * a response that doesn't parse as JSON. Never carries a stack trace or
 * internal detail beyond what the API's own error body safely exposed. */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

/**
 * The one place every request to the PaySherlock API goes through. Callers
 * get a parsed JSON value or a thrown ApiError — never a raw fetch
 * Response, never a leaked stack trace.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });
  } catch {
    throw new ApiError(
      "Could not reach the PaySherlock API. Check that it's running and reachable.",
      0,
      "NETWORK_ERROR",
    );
  }

  const text = await response.text();
  let body: unknown;
  try {
    body = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }

  if (!response.ok) {
    const errorBody = body as ApiErrorBody | undefined;
    throw new ApiError(
      errorBody?.error?.message ?? "The request failed.",
      response.status,
      errorBody?.error?.code,
    );
  }

  return body as T;
}
