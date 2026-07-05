/**
 * Type-only companion for PipelineBankConfig — interfaces + narrow aliases.
 * Keeps the main file under the max-lines ceiling while preserving
 * Rule #15 named-alias discipline.
 */

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
  'international-plus' | 'international-dash' | 'international-flat' | 'local-only';

/**
 * Balance semantics for a bank — an explicit, REQUIRED per-bank declaration.
 * `'account'` banks expose a real account balance (deposit/checking banks)
 * and trigger a live BALANCE-RESOLVE; `'card-cycle'` banks expose only
 * per-cycle credit-card billing aggregates (VisaCal, Max, Amex, Isracard) and
 * have no account balance to resolve (deterministic no-op). Never inferred
 * from absence — an unstated kind is a config error, not a dormant no-op.
 */
export type BalanceKind = 'account' | 'card-cycle';

/**
 * Auth-completion family for a bank -- an explicit, REQUIRED per-bank declaration.
 * Documents HOW a completed browser login is verified:
 *   - 'token'         -- a Bearer/JWT is discovered post-auth (FIBI/Mataf, Cal).
 *   - 'session-cookie'-- auth is carried by first-party session cookies
 *                        (telebank, Wix-shell, Angular SPA banks).
 *   - 'api-direct'    -- no browser AUTH-DISCOVERY at all (OneZero/PayBox/Pepper
 *                        run the headless identity strategy).
 * The BIND-API-MEDIATOR auth-prime consumes 'token' (reads the post-login token
 * and installs it on the browser-page mediator); 'session-cookie' is a no-op
 * there. The runtime dashboard gate does NOT branch on this value. Never
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
   * Set for AngularJS-SPA banks (Amex, Isracard) where the SSO redirect
   * fires the accounts call inside the login boundary, so the histogram
   * captures whether that hit landed. Authentication itself is proven later
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
   * Set for slow-AngularJS banks whose login form lingers while the SSO
   * redirect settles.
   */
  readonly loginCompletionPoll?: {
    readonly intervalMs: number;
    readonly maxAttempts: number;
  };
  /**
   * SPA build-version query key (e.g. Max's `'v'`). When set, BIND-API-MEDIATOR
   * scans the live page's resource-timing buffer for the first request carrying
   * `?<key>=<value>` and stashes `<value>` on the mediator session-context as
   * `clientVersion`, letting browser hard-model shapes reconstruct versioned API
   * URLs. Absent ⇒ no scan (banks whose APIs carry no build-version param).
   */
  readonly clientVersionParam?: string;
  /**
   * Post-auth session-token capture — for banks whose API carries a body-borne
   * session id (e.g. Leumi's WCF `reqObj.SessionHeader.SessionID`) instead of a
   * header/cookie token. BIND-API-MEDIATOR reads the login-inclusive discovery
   * pool (open from `pre-login` onward via the network-trace lifecycle
   * interceptor), finds the first POST whose URL includes `urlMatch`, decodes
   * the body, walks `tokenPath`, and stashes the leaf on the mediator
   * session-context as `sessionToken`. ONLY the matched bank endpoint is
   * inspected — credential POSTs are never read (PII-safe by extraction scope).
   * Absent ⇒ no capture (header-token / cookie banks).
   */
  readonly sessionTokenCapture?: {
    /** Substring identifying the bank's post-auth API endpoint URL. */
    readonly urlMatch: string;
    /** Top-level postData key whose string value is itself JSON (WCF `reqObj`). */
    readonly bodyField?: string;
    /** Ordered keys within the decoded body to the token leaf. */
    readonly tokenPath: readonly string[];
  };
  /**
   * Opt-in: install the FULL discovered-header bag (SPA content-negotiation
   * headers + Origin / Referer / X-Site-Id, plus the discovered token as
   * Authorization) on EVERY hard-model call, replicating the generic
   * AUTH-DISCOVERY green path. BIND-API-MEDIATOR reads the login-inclusive
   * capture pool once, builds the bag via `buildDiscoveredHeadersFromCapture`,
   * and passes it to the browser-page mediator's fetch strategy as defaults
   * (per-call and rawAuth headers still win). Set for `'token'` browser banks
   * whose SPA API rejects a bare cookie/Bearer without the negotiation headers
   * (VisaCal needs X-Site-Id; the FIBI BFF needs Accept: application/json).
   * Absent/false ⇒ empty bag ⇒ the mediator is byte-identical to no wrap.
   */
  readonly installDiscoveredHeaders?: boolean;
  /**
   * Post-login auth-header sniff — for banks whose API Bearer is injected by the
   * SPA's own HTTP interceptor and appears in NO login response body nor a
   * parseable sessionStorage shape (FIBI's `appsng` BFF: the token rides only
   * the SPA's own authorized requests). BIND-API-MEDIATOR scans the
   * login-inclusive capture pool for the FIRST request whose URL includes this
   * substring carrying a non-empty `authorization` / `x-auth-token` header and
   * installs that value verbatim as the discovered Authorization — taking
   * priority over the generic 5-tier discovery so a wrong-family token is never
   * picked. Scoped to the bank's own SPA endpoint family (e.g. `'appsng/bff-'`);
   * the pre-token OAuth code-exchange carries no Bearer and is skipped
   * naturally. Absent ⇒ no sniff (generic discovery runs unchanged).
   */
  readonly authHeaderUrlMatch?: string;
  /**
   * Opt-in: capture the TCS BaNCS session values (the auth `SecToken` block +
   * the portfolio `iorId`/`Id`) at BIND-API-MEDIATOR. For BaNCS Digital banks
   * (Yahav) whose every post-login API request is a `MessageEnvelope` carrying
   * a body-borne `SecToken` + portfolio refs the SPA established during login.
   * BIND scans the login-inclusive pool for the accounts POST
   * (`/BaNCSDigitalApp/account`) whose `postData` holds a filled `SecToken` +
   * `Payload.DataEntity[0].Prtflio.Id`, and stashes `bancsSecToken` /
   * `bancsPortfolioIorId` / `bancsPortfolioId` on the mediator
   * session-context for the hard-model shape to reconstruct each request.
   * ONLY the accounts endpoint family is inspected — the credential POST is
   * never read (PII-safe by extraction scope). Absent ⇒ no capture.
   */
  readonly bancsSessionCapture?: boolean;
}
