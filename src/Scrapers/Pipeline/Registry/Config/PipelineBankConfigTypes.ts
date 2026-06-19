/**
 * Type-only companion for PipelineBankConfig — interfaces + narrow aliases.
 * Keeps the main file under the max-lines ceiling while preserving
 * Rule #15 named-alias discipline.
 */

import type { BalanceKind } from '../WK/BalanceKind.js';

/**
 * Re-exported for back-compat — the canonical home is
 * {@link ACCOUNT_BALANCE_FAMILY | WK/BalanceKind}. Consumers that
 * imported `BalanceKind` from this module keep working.
 */
export type { BalanceKind };

/** Generic auth-path keys — per-bank subsets plug into `paths` below. */
export type AuthPathKey =
  | 'identity.deviceToken'
  | 'identity.otpPrepare'
  | 'identity.otpVerify'
  | 'identity.getIdToken'
  | 'identity.sessionToken'
  | 'identity.phoneValidate'
  | 'identity.pinValidation'
  | 'identity.loginBySms'
  | 'auth.bind'
  | 'auth.assert'
  | 'auth.logout'
  | 'data.sync'
  | 'data.getUserHistory'
  | 'data.virtualCardTranRequest';

/**
 * Per-bank wire format for the caller's `phoneNumber` credential.
 * Mirrors {@link PhoneNumberFormat} in the credentials mediator —
 * caller always supplies digits-only international form; the
 * pipeline edge runs the matching transform before the bank's
 * login flow consumes the value.
 */
export type PhoneNumberFormatTag =
  | 'international-plus'
  | 'international-dash'
  | 'international-flat'
  | 'local-only';

/** Headless-strategy URL block — populates ctx.apiMediator at build time. */
export interface IHeadlessUrlsConfig {
  readonly identityBase: string;
  readonly graphql: string;
  /** Per-bank auth-path map — only the keys the bank actually uses. */
  readonly paths: Readonly<Partial<Record<AuthPathKey, string>>>;
  /** Static Authorization header installed before login (e.g. Transmit TSToken). */
  readonly staticAuth?: string;
  /**
   * When true, identity API calls (NOT graphql) are routed through a Camoufox
   * browser session to bypass Cloudflare's Node-TLS bot rule. Default: undefined
   * (treated as false). Only set for banks whose identity host gates Node TLS.
   */
  readonly requiresBrowserTls?: boolean;
  /**
   * When set, the Camoufox identity strategy route-intercepts the
   * initial navigation to the identity origin URL and serves a blank
   * HTML stub (`<!doctype html><html><head></head><body></body></html>`).
   * The stub gives the page a clean on-origin context without entering
   * the Cloudflare interstitial / CSP state, so subsequent
   * `page.evaluate(fetch …)` calls reach the real `/api/*` endpoints
   * over Camoufox's Firefox-profile HTTP/2 + TLS.
   *
   * Required for banks whose identity host returns a Cloudflare
   * challenge page on root navigation (e.g. PayBox's
   * `apipin.payboxapp.com`). Default `false` — OneZero / Pepper
   * identity hosts don't gate root navigation with an interstitial.
   *
   * Bypass validated by `c:\tmp\paybox-camoufox-probe3.mjs` (probe
   * succeeded with 400 Validation Error from the API; without the
   * stub, probe2 saw NetworkError on every header combination).
   */
  readonly bypassOriginChallenge?: boolean;
  /**
   * Wire format the bank expects for `creds.phoneNumber`. Caller
   * always supplies digits-only international form (e.g.
   * `972000000000`); the pipeline edge rewrites to this format
   * before the login flow runs.
   *
   * Absent ⇒ no transform (caller's value passes through).
   */
  readonly phoneNumberFormat?: PhoneNumberFormatTag;
}

/** Pipeline bank config — HOME phase URL + optional headless URLs. */
export interface IPipelineBankConfig {
  /** Official website URL — HOME phase navigates here. */
  readonly urls: {
    readonly base: string;
  };
  /**
   * Balance semantics this bank exposes. Scopes BALANCE-RESOLVE (and
   * the legacy SCRAPE fieldMap) to the matching alias family so a
   * card bank never resolves an account alias (and vice-versa).
   * Mandatory — every registered bank declares its kind explicitly.
   */
  readonly balanceKind: BalanceKind;
  /** Fallback transaction API path — used when network discovery finds nothing. */
  readonly transactionsPath?: string;
  /** Headless-strategy URLs — populated for API-native banks (no browser). */
  readonly headless?: IHeadlessUrlsConfig;
}
