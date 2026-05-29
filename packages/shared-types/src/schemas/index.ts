/**
 * Barrel for the API-contract Zod schemas (schemas/ only).
 *
 * These mirror docs/architecture/02-API-CONTRACT.md and are the source of truth
 * for the OpenAPI spec + generated TS/Swift clients. The package-level barrel
 * (src/index.ts) is wired separately by the human — do not import this from
 * there here.
 */
export * from "./metrics";
export * from "./exercises";
export * from "./profile";
export * from "./coach";
export * from "./push";
