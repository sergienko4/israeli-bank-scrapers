/**
 * Type-only companion for PipelineBankConfig — interfaces + narrow aliases.
 * Keeps the main file under the max-lines ceiling while preserving
 * Rule #15 named-alias discipline.
 */

import type { TlsClientProfileKind } from '../../Strategy/Fetch/Tls/TlsClientProfiles.js';
import type { IDynamicClientCert } from '../../Types/Domain/ClientCertControl.js';
import type {
  IResponseIntegrity,
  MediaTypePolicy,
  RedirectPolicy,
  StatusPolicy,
} from '../../Types/Domain/FetchPolicy.js';

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
  | 'auth.login'
  | 'auth.assert'
  | 'auth.logout'
  | 'auth.prime'
  | 'auth.resume'
  | 'auth.service'
  | 'auth.bootstrap'
  | 'auth.landing'
  | 'auth.logon'
  | 'auth.encryptionKey'
  | 'auth.identify'
  | 'auth.verify'
  | 'auth.otpInit'
  | 'auth.otpVerify'
  | 'data.sync'
  | 'data.getKey'
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
  'international-plus' | 'international-dash' | 'international-flat' | 'local-only';

/**
 * Balance semantics for a bank — an explicit, REQUIRED per-bank declaration.
 * `'account'` banks expose a real account balance (deposit/checking banks)
 * and trigger a live BALANCE-RESOLVE; `'card-cycle'` banks expose no account
 * balance, only billing-cycle figures — a per-card debit (VisaCal, Max,
 * Isracard, Amex) — which their scrape shape's balance step owns, so
 * BALANCE-RESOLVE is a deterministic no-op for them. Never
 * inferred from absence — an unstated kind is a config error, not a dormant
 * no-op.
 */
export type BalanceKind = 'account' | 'card-cycle';

/**
 * Auth-completion family for a bank -- an explicit, REQUIRED per-bank declaration.
 * Documents HOW a completed login is verified:
 *   - 'token'         -- a Bearer/JWT is discovered post-auth (FIBI/Mataf, Cal).
 *   - 'session-cookie'-- auth is carried by first-party session cookies
 *                        (telebank, Wix-shell, Angular SPA banks).
 *   - 'api-direct'    -- no browser AUTH-DISCOVERY at all (OneZero/PayBox/Pepper
 *                        run the headless identity strategy).
 * The runtime dashboard gate does NOT branch on this value. Never
 * inferred from absence -- an unstated kind is a config error.
 */
export type AuthStrategyKind = 'token' | 'session-cookie' | 'api-direct';

/** Headless-strategy URL block — populates ctx.apiMediator at build time. */
export interface IHeadlessUrlsConfig {
  readonly identityBase: string;
  readonly graphql: string;
  /** Per-bank auth-path map — only the keys the bank actually uses. */
  readonly paths: Readonly<Partial<Record<AuthPathKey, string>>>;
  /** Static Authorization header installed before login (e.g. Transmit TSToken). */
  readonly staticAuth?: string;
  /**
   * Header floor merged UNDER every GraphQL call's per-call headers
   * (per-call wins). Set it for banks whose GraphQL gateway sits behind an
   * edge WAF that allow-lists a specific client identity on EVERY request —
   * including the post-auth probe, which carries no shape-level headers.
   * Default: undefined (treated as an empty bag ⇒ byte-identical behaviour).
   */
  readonly graphqlHeaders?: Readonly<Record<string, string>>;
  /**
   * When true, identity + graphql calls present the bank's registered client
   * certificate (see ClientCertRegistry) over `node:https` (mutual-TLS) to
   * satisfy a Cloudflare API Shield mTLS gate. Default: undefined (treated as
   * false). Mutually exclusive with `nativeFetch`, because both cannot drive
   * identity. The certificate alone does not always pass the edge: a host
   * that also fingerprints the handshake needs `tlsProfile` as well.
   * Only set for banks whose identity host returns 403 without a client cert
   * (e.g. OneZero's `*.tfd-bank.com`).
   */
  readonly requiresClientCert?: boolean;
  /**
   * A device certificate the login flow obtains at runtime and installs
   * through the mediator's `clientCert` port (a step's `clientCert` field).
   * It is presented to `origin` only — an exact https origin — and never
   * written anywhere. Selects the node:https transport. Mutually exclusive
   * with `nativeFetch`. Default: undefined.
   */
  readonly clientCert?: IDynamicClientCert;
  /**
   * ClientHello profile that identity + graphql calls present over
   * `node:https`, for edges that admit only the bank app's TLS fingerprint.
   * Setting it selects the node:https transport, with or without a client
   * certificate. Mutually exclusive with `nativeFetch`. Default:
   * undefined (Node's stock handshake).
   */
  readonly tlsProfile?: TlsClientProfileKind;
  /**
   * When true, identity calls run over Node's built-in `fetch` with no
   * custom TLS handshake — for banks whose edge admits a plain Node client.
   * Mutually exclusive with `requiresClientCert`, `clientCert` and
   * `tlsProfile`. A headless block that declares none of the three
   * transports fails closed with a wiring error.
   */
  readonly nativeFetch?: boolean;
  /** Disable native connect-timeout retries, including on manual redirect hops. */
  readonly isConnectRetryDisabled?: boolean;
  /**
   * When true, the node identity transport keeps one cookie jar for the
   * run: every response's Set-Cookie feeds it and every POST and GET sends
   * it as one `cookie` header. For banks whose session is a cookie rather
   * than an auth header. Default: undefined (no jar; headers unchanged).
   */
  readonly sessionCookies?: boolean;
  /**
   * With `sessionCookies`, switches the jar to the RFC 6265 domain jar: a
   * cookie whose `Domain` is one of these registrable domains (and matches
   * the answering host) is shared with every host under it; any other
   * `Domain` stays host-only or is dropped. Exposes the run's cookie session
   * to login steps. Default: undefined (the origin-scoped jar).
   */
  readonly cookieDomains?: readonly string[];
  /**
   * With `nativeFetch`, the redirect policy every call of the bank (login
   * and scrape) runs under unless its step names its own `redirect`:
   * `reject` refuses any 3xx. A manual policy belongs on a GET step's
   * `redirect` — an api-direct build refuses it here, and a bank with a
   * manual step must default to `reject`.
   * Default: undefined (`follow` — fetch follows redirects itself).
   */
  readonly redirectPolicy?: RedirectPolicy;
  /**
   * With `nativeFetch`, the 2xx statuses every call of the bank (login and
   * scrape) decides before its body is read: `empty` answers `{}` (not on a
   * `response: 'document'` step), `fail` refuses the call. Default:
   * undefined (no status decided; every 2xx is read).
   */
  readonly statusPolicy?: StatusPolicy;
  /**
   * With `nativeFetch`, omit bank response text from HTTP failures, including
   * data calls. WAF classification still reads the body first. Default:
   * undefined (generic failures keep their response snippet).
   */
  readonly omitBankText?: boolean;
  /**
   * Media type each response kind's answer must name when its call names
   * none, e.g. `{ json: 'application/json' }`; requires `nativeFetch`.
   * Undefined → no default; only a call's own `mediaType` is checked.
   */
  readonly mediaTypes?: MediaTypePolicy;
  /**
   * Decode every answer as strict UTF-8: a malformed byte fails the
   * call `body not utf-8` instead of becoming U+FFFD. A step's own
   * `strictUtf8: false` lifts it for that call; requires `nativeFetch`.
   * Undefined → bodies read as `text()` does, unless a step says otherwise.
   */
  readonly strictUtf8?: true;
  /** Native response byte limit and optional digest, overridden by a step. */
  readonly responseIntegrity?: IResponseIntegrity;
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
   * Disable phase retries and HOME's crash reload, and submit login once
   * through a single click. Absent preserves existing recovery behavior.
   * This does not change observation polling or transport-level retries.
   */
  readonly disablePhaseRetry?: true;
  /** Fallback transaction API path — used when network discovery finds nothing. */
  readonly transactionsPath?: string;
  /** Headless-strategy URLs — populated for API-native banks (no browser). */
  readonly headless?: IHeadlessUrlsConfig;
  /**
   * Balance semantics — see {@link BalanceKind}. REQUIRED: every bank states
   * its kind explicitly — `'account'` (live balance resolved) or `'card-cycle'`
   * (deterministic no-op). Never inferred from absence — an unstated kind is a
   * config error, not a silent dormant no-op.
   */
  readonly balanceKind: BalanceKind;
  /**
   * Auth-completion family -- see {@link AuthStrategyKind}. REQUIRED: every bank
   * states its kind explicitly. Declarative documentation + registry-completeness
   * contract; the runtime gate does not branch on it.
   */
  readonly authStrategyKind: AuthStrategyKind;
  /**
   * Advisory observation budget (ms) for the post-login accounts-traffic
   * histogram. When set, LOGIN.POST waits up to this budget so the PII-safe
   * login.authconfirm.pool diagnostic is emitted; it NEVER gates login
   * completion. Absent ⇒ the wait uses the default short budget.
   *
   * Built for AngularJS-SPA logins where the SSO redirect fires the accounts
   * call inside the login boundary, so the histogram captures whether that
   * hit landed. No bank opts in today. Authentication itself is proven later
   * at AUTH-DISCOVERY, keeping LOGIN and AUTH cleanly separated.
   */
  readonly loginAuthConfirmMs?: number;
  /**
   * Login-completion settle-poll budget. When set, the LOGIN.final completion
   * observer re-checks the LOGIN-LOCAL settle signals (form-gone / advanced /
   * error / spinner) up to `maxAttempts` times, waiting `intervalMs` between
   * checks. Absent ⇒ single-shot (one capture, zero wait) — byte-identical to
   * a direct capture and zero added wall-time.
   *
   * ENFORCED when opted in: a bank whose poll budget is exhausted while the
   * filled login form is still on screen fails LOGIN.final non-retryably with
   * LOGIN_NOT_COMPLETED. A non-opted bank always succeeds (the single-shot
   * poll settles on the first capture), so the verdict is unchanged for it.
   * Built for slow-AngularJS logins whose form lingers while the SSO
   * redirect settles. No bank opts in today.
   */
  readonly loginCompletionPoll?: {
    readonly intervalMs: number;
    readonly maxAttempts: number;
  };
  /**
   * Post-login navigation the browser performs in AUTH-DISCOVERY, BEFORE the
   * cookie-audit, to mint the data-API session for banks whose data API lives
   * on a DIFFERENT origin than the login page (FIBI: login on `www.<host>`,
   * data API on `online.<host>`). Navigating to the SPA frontend route drives
   * the browser onto the data-API origin so its SPA runs the session handshake
   * — the hand-off the removed DASHBOARD phase used to perform. Absent ⇒ no nav
   * (banks whose data API is same-origin as login).
   */
  readonly postLoginNav?: { readonly url: string; readonly settleMs?: number };
}
