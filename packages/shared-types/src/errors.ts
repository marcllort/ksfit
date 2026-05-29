import { z } from "zod";

/**
 * The single error envelope every non-2xx backend response uses
 * (RFC 9457-flavored). Mirrors docs/architecture/02-API-CONTRACT.md §Error model.
 */
export const ErrorCode = z.enum([
  "invalid_request",
  "unauthenticated",
  "provider_not_connected",
  "forbidden",
  "not_found",
  "conflict",
  "metric_unavailable",
  "rate_limited",
  "not_implemented",
  "provider_error",
  "provider_unconfigured",
  "internal",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorBody = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    requestId: z.string().optional(),
  }),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

/** Default HTTP status for each error code. */
export const STATUS_FOR_CODE: Record<ErrorCode, number> = {
  invalid_request: 400,
  unauthenticated: 401,
  provider_not_connected: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  metric_unavailable: 422,
  rate_limited: 429,
  not_implemented: 501,
  provider_error: 502,
  provider_unconfigured: 503,
  internal: 500,
};
