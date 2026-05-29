/**
 * Web shim over the framework-agnostic Fitbit OAuth in @stride/health-core.
 *
 * The OAuth wire logic + config now live in the package; this file binds them
 * to the Next.js cookie store so the web app's existing routes keep working
 * until they're rewired to call the backend.
 */
import {
  exchangeCode as exchangeCodeCore,
  type FitbitTokens,
} from "@stride/health-core";
import { webTokenStore } from "./web-store";

export {
  FITBIT_CLIENT_ID,
  FITBIT_CLIENT_SECRET,
  FITBIT_REDIRECT_URI,
  fitbitConfigured,
  type FitbitTokens,
} from "@stride/health-core";

/** Exchange an authorization code (PKCE) for tokens and persist to the cookie. */
export async function exchangeCode(
  code: string,
  codeVerifier: string,
): Promise<FitbitTokens> {
  return exchangeCodeCore(await webTokenStore(), code, codeVerifier);
}
