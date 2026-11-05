/**
 * Auth-mode policy (AD9). One map keyed by `AuthScheme` decides how a login's
 * token becomes the Authorization header and how the mediator treats a later
 * auth rejection. `'none'` serves a bank whose session is a cookie: the flow
 * needs no `carry.token`, no Authorization header is sent, the callback bearer
 * is `''`, and a rejection fails at once instead of re-running the login.
 * The flow's `authRecovery` then reshapes the scheme's policy (N33).
 */

import type { IMediatorAuthPolicy } from '../../../Types/Domain/MediatorAuthPolicy.js';
import type { AuthRecovery, AuthScheme, IApiDirectCallConfig } from '../ConfigContracts/index.js';

/**
 * What one auth scheme asks of the login flow and the mediator. With
 * `installHeader` the flow must end with a `carry.token`, sent as the
 * Authorization header.
 */
type IAuthModePolicy = IMediatorAuthPolicy;

/** Builds the header value from the login token and the configured prefix. */
type AuthFormatter = (token: string, prefix: string) => string;

/** One scheme's row: the policy it hands out and how it renders the header. */
interface IAuthSchemeRow {
  readonly policy: IAuthModePolicy;
  readonly format: AuthFormatter;
}

/** Policy shared by every scheme that sends an Authorization header. */
const HEADER_POLICY: IAuthModePolicy = { installHeader: true, rearmOnReject: true };

/** Cookie-session policy: no header, and no re-login on a rejection. */
const COOKIE_POLICY: IAuthModePolicy = { installHeader: false, rearmOnReject: false };

/** Reshapes a scheme's policy for one auth-recovery mode. */
type RecoveryOverlay = (policy: IAuthModePolicy) => IAuthModePolicy;

/**
 * Keep the scheme's own policy: a rejected call is re-minted and retried.
 * @param policy - The scheme's policy.
 * @returns The same policy.
 */
function recoverPerRequest(policy: IAuthModePolicy): IAuthModePolicy {
  return policy;
}

/**
 * Fail a rejected call at once and let the scrape recover as a whole: a
 * retried call would carry a session the bank has already moved past.
 * @param policy - The scheme's policy.
 * @returns The policy with re-arming off and whole-scrape recovery on.
 */
function recoverWholeScrape(policy: IAuthModePolicy): IAuthModePolicy {
  return { ...policy, rearmOnReject: false, wholeScrapeRecovery: true };
}

/** Every auth-recovery mode, one overlay each. */
const AUTH_RECOVERIES: Readonly<Record<AuthRecovery, RecoveryOverlay>> = {
  'per-request': recoverPerRequest,
  'whole-scrape': recoverWholeScrape,
};

/**
 * Send the token as is.
 * @param token - Login token.
 * @returns The token.
 */
function formatRaw(token: string): string {
  return token;
}

/**
 * Send the token as a bearer credential.
 * @param token - Login token.
 * @returns `Bearer <token>`.
 */
function formatBearer(token: string): string {
  return `Bearer ${token}`;
}

/**
 * Send the token after the bank's own scheme word.
 * @param token - Login token.
 * @param prefix - Configured `authPrefix`.
 * @returns `<prefix><token>`.
 */
function formatPrefixed(token: string, prefix: string): string {
  return `${prefix}${token}`;
}

/**
 * Send no Authorization header.
 * @returns An empty header value, which the transport omits.
 */
function formatNone(): string {
  return '';
}

/** Every auth scheme, one row each. */
const AUTH_SCHEMES: Readonly<Record<AuthScheme, IAuthSchemeRow>> = {
  raw: { policy: HEADER_POLICY, format: formatRaw },
  bearer: { policy: HEADER_POLICY, format: formatBearer },
  prefixed: { policy: HEADER_POLICY, format: formatPrefixed },
  none: { policy: COOKIE_POLICY, format: formatNone },
};

/**
 * Look up the row for the bank's auth scheme.
 * @param config - API-direct-call config.
 * @returns The row for the configured scheme, `'raw'` by default.
 */
function schemeRowOf(config: IApiDirectCallConfig): IAuthSchemeRow {
  const scheme = config.authScheme ?? 'raw';
  return AUTH_SCHEMES[scheme];
}

/**
 * Look up the bank's auth-mode policy.
 * @param config - API-direct-call config.
 * @returns The configured scheme's policy, reshaped by its `authRecovery`.
 */
function authPolicyOf(config: IApiDirectCallConfig): IAuthModePolicy {
  const { policy } = schemeRowOf(config);
  const overlay = AUTH_RECOVERIES[config.authRecovery ?? 'per-request'];
  return overlay(policy);
}

/**
 * Format the Authorization header value per `config.authScheme`.
 * @param config - API-direct-call config.
 * @param token - Raw token string (no prefix).
 * @returns Authorization header value (`''` for `'none'`).
 */
function formatAuthValue(config: IApiDirectCallConfig, token: string): string {
  const { format } = schemeRowOf(config);
  return format(token, config.authPrefix ?? '');
}

export type { IAuthModePolicy };
export { authPolicyOf, formatAuthValue };
