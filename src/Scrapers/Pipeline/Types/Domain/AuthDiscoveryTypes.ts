/**
 * Auth-discovery domain types — split out of PipelineContext.ts
 * for Phase 1 god-file decoupling.
 *
 * Public surface (re-exported via PipelineContext.ts barrel):
 *  - IAuthDiscovery, AuthDiscoveryFailCode
 *  - EMPTY_AUTH_DISCOVERY (test-path default)
 */

/**
 * Auth-discovery snapshot committed by AUTH-DISCOVERY.FINAL —
 * Mission 1 of the CI quality hardening plan.
 *
 * <p>Single source of truth for "we are authenticated AND on the
 * dashboard". Replaces the auth-token + dashboard-reveal work
 * previously scattered across LOGIN.FINAL (LoginSignalProbe) and
 * OTP-FILL.PRE (maybeFastPathSuccess). The phase mirrors
 * ACCOUNT-RESOLVE: PRE inventories, ACTION collects, POST
 * validates, FINAL emits this slim value type.
 *
 * <p>Fields:
 * <ul>
 *   <li>{@link authToken} — bearer token discovered in headers /
 *       response bodies / sessionStorage. `false` for banks that
 *       authenticate via cookies only (Discount, Hapoalim, …).</li>
 *   <li>{@link origin} — origin URL captured from request headers
 *       (e.g. `https://www.fibi.co.il`). `false` when no captures
 *       have an Origin header set.</li>
 *   <li>{@link siteId} — site-id header value (X-Site-Id, etc.).
 *       `false` when no bank-specific site-id is exposed.</li>
 *   <li>{@link headers} — full discovered fetch-header bag built
 *       from in-flight traffic; ready to pass to fetchStrategy.
 *       Empty object when no captures were available.</li>
 *   <li>{@link dashboardReady} — `true` when AUTH-DISCOVERY's reveal
 *       probe found at least one dashboard marker; `false` when the
 *       probe budget elapsed with no reveal.</li>
 *   <li>{@link sessionCookieNames} — names (not values) of session
 *       cookies present at AUTH-DISCOVERY entry. Used for telemetry
 *       only — never logged with values.</li>
 *   <li>{@link hasAuthApiResponse} — `true` when a captured first-party
 *       well-known account-data API response is present at
 *       AUTH-DISCOVERY. An unauthenticated page never makes the authed
 *       data fetch.</li>
 * </ul>
 */
interface IAuthDiscovery {
  readonly authToken: string | false;
  readonly origin: string | false;
  readonly siteId: string | false;
  readonly headers: Readonly<Record<string, string>>;
  readonly dashboardReady: boolean;
  readonly sessionCookieNames: readonly string[];
  readonly hasAuthApiResponse: boolean;
}

/**
 * Fail-loud codes emitted by AUTH-DISCOVERY.POST. Closed list,
 * exhaustive — every fail path uses one of these values.
 */
type AuthDiscoveryFailCode =
  | 'AUTH_DISCOVERY_SESSION_INVALID'
  | 'AUTH_DISCOVERY_DASHBOARD_NOT_READY'
  | 'AUTH_DISCOVERY_TOKEN_REQUIRED_AND_MISSING';

/**
 * Stable fail-code string for the dashboard-not-ready failure — the
 * single source of truth shared by AUTH-DISCOVERY.FINAL (the emitter)
 * and the pipeline reducer (which matches it to keep that one honest
 * failure non-retryable; one try is enough on a stuck-on-login page).
 */
const AUTH_DISCOVERY_NOT_READY_CODE = 'AUTH_DISCOVERY_DASHBOARD_NOT_READY' as const;

/**
 * Empty default for test paths. Mirrors the EMPTY_AUTH_DISCOVERY's role
 * in the ACCOUNT-RESOLVE / TXN-endpoint patterns.
 */
const EMPTY_AUTH_DISCOVERY: IAuthDiscovery = {
  authToken: false,
  origin: false,
  siteId: false,
  headers: {},
  dashboardReady: false,
  sessionCookieNames: [],
  hasAuthApiResponse: false,
};

export type { AuthDiscoveryFailCode, IAuthDiscovery };
export { AUTH_DISCOVERY_NOT_READY_CODE, EMPTY_AUTH_DISCOVERY };
