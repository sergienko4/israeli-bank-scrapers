/**
 * LoginKind — discriminator produced by the API-DIRECT-CALL phase
 * PRE stage classifier (see ApiDirectCallActions.classifyLoginKind).
 * The phase uses this value for diagnostic logging only — the actual
 * work lives inside the token-strategy primeInitial path.
 */

/** Discriminator for the PRE stage forensic result. */
type LoginKind =
  | 'stored-jwt-fresh'
  | 'stored-jwt-stale'
  | 'sms-otp'
  | 'password-only'
  | 'bearer-static'
  | 'unknown';

export type { LoginKind as default };
