/**
 * @stride/ksfit-client — the KS Fit / WalkingPad treadmill data layer.
 *
 * Pure TypeScript (no React, no server-only APIs): the raw cloud client, the
 * domain normalizers + formatters, CSV serialization, and the synthetic demo
 * dataset. Consumed by the backend (provider host) and the web app (types).
 */
export * from "./ksfit";
export * from "./data";
export * from "./csv";
export * from "./demo";
