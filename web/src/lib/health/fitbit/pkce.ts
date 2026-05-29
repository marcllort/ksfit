/**
 * PKCE helpers for the Fitbit Authorization Code + PKCE flow.
 * Verifier: 43-128 char URL-safe random; challenge = base64url(SHA-256(verifier)).
 */
import { createHash, randomBytes } from "node:crypto";

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function generateVerifier(): string {
  // 64 random bytes → 86 base64url chars (within the 43-128 range).
  return base64url(randomBytes(64));
}

export function challengeFromVerifier(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

export function randomState(): string {
  return base64url(randomBytes(16));
}
