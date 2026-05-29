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
export * from "./metrics";
