/**
 * @stride/health-core — the provider-agnostic health-data seam.
 *
 * Exposes the `HealthProvider` interface and the shared domain types every
 * provider (Fitbit today, Google Health from Phase 4) implements, plus the
 * derived-metric computations (added in Phase 3). Framework-agnostic: no
 * Next.js, no cookies, no node-only APIs in this entry point — so it's safe to
 * import from the web app, the backend, and unit tests alike.
 *
 * Provider implementations that need server-only APIs (node:crypto, token
 * persistence) live in subpaths and are imported only by server code.
 */
export * from "./types";
export * from "./fitbit/oauth";
export * from "./fitbit/pkce";
export { FitbitProvider, FitbitRateLimitError } from "./fitbit/provider";
export { GoogleHealthProvider } from "./google/provider";
// Google OAuth shares generic symbol names with Fitbit's (exchangeCode,
// refreshTokens, getFreshTokens, TokenStore-shaped types). A bare `export *`
// from both would make those names ambiguous and unreachable, so we re-export
// the Google-specific, non-colliding symbols explicitly. Server code that needs
// the generic OAuth fns imports them from "@stride/health-core/google" directly.
export {
  GOOGLE_AUTH_URL,
  GOOGLE_HEALTH_CLIENT_ID,
  GOOGLE_HEALTH_CLIENT_SECRET,
  GOOGLE_HEALTH_REDIRECT_URI,
  GOOGLE_HEALTH_SCOPES,
  googleHealthConfigured,
  type GoogleHealthTokens,
  type GoogleTokenStore,
} from "./google/oauth";
export * from "./metrics";
