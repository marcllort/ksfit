/**
 * PKCE helpers for the Google Health Authorization Code + PKCE flow.
 *
 * Google's OAuth 2.0 PKCE rules are identical to Fitbit's (RFC 7636): a 43-128
 * char URL-safe verifier, challenge = base64url(SHA-256(verifier)), S256 method.
 * Rather than duplicate the implementation we re-export the Fitbit helpers.
 * See https://developers.google.com/identity/protocols/oauth2/native-app#step1-code-verifier
 */
export {
  generateVerifier,
  challengeFromVerifier,
  randomState,
} from "../fitbit/pkce";
