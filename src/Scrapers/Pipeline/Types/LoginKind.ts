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

/** Set of all LoginKind values — used by tests + validators. */
const LOGIN_KIND_VALUES: readonly LoginKind[] = [
  'stored-jwt-fresh',
  'stored-jwt-stale',
  'sms-otp',
  'password-only',
  'bearer-static',
  'unknown',
];

export type { LoginKind };
export { LOGIN_KIND_VALUES };
