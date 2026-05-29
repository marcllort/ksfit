import type { Context } from "hono";
import { type ErrorCode, STATUS_FOR_CODE } from "@stride/shared-types";

/**
 * Throwable API error carrying a stable machine code. The error middleware
 * turns it into the standard envelope. Use `apiError(c, ...)` for inline
 * returns or `throw new ApiError(...)` from deeper code.
 */
export class ApiError extends Error {
  code: ErrorCode;
  details?: Record<string, unknown>;
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
  }
}

/** Build the standard error JSON response on a Hono context. */
export function apiError(
  c: Context,
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
) {
  const status = STATUS_FOR_CODE[code];
  return c.json(
    {
      error: {
        code,
        message,
        ...(details ? { details } : {}),
        requestId: c.get("requestId") as string | undefined,
      },
    },
    // Hono types want a ContentfulStatusCode; our map is always a valid one.
    status as 400,
  );
}
