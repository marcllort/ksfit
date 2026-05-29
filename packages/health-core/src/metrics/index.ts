/**
 * @stride/health-core metrics — WHOOP-style derived computations.
 *
 * Pure, deterministic, network-free functions (data-model §4): the nightly
 * derivation job feeds them normalized provider data + the user's history and
 * writes the results into `daily_scores`. The AI coach reads the snapshots; it
 * never recomputes a health value itself.
 *
 * Barrel for this directory only.
 */
export * from "./baseline";
export * from "./hrv";
export * from "./recovery";
export * from "./strain";
export * from "./sleep";
export * from "./stress";
export * from "./fitnessAge";
