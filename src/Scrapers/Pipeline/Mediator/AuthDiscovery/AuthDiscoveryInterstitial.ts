/**
 * Mission M4.F1 — AUTH-DISCOVERY.FINAL dashboard gate.
 *
 * <p>Replaces the deleted `WK_BANK_REDIRECT` markers (commit
 * `6d106cca` removed them) with a generic two-signal gate that
 * needs no bank-specific URL substrings, no parallel "clickable
 * element" CSS list, and no second selector pipeline:
 * <ol>
 *   <li>POSITIVE: {@link WK_DASHBOARD.REVEAL} matched at
 *       AUTH-DISCOVERY.POST (carried as `snap.dashboardReady`).</li>
 *   <li>NEGATIVE: the page URL has actually changed since the URL
 *       LOGIN.PRE captured (`currentUrl !== preAuthUrl`).</li>
 * </ol>
 * The gate commits when the signals agree; otherwise AUTH-DISCOVERY.FINAL
 * fails loud with `AUTH_DISCOVERY_DASHBOARD_NOT_READY`, so DASHBOARD.PRE
 * never wastes its 122 s resolver budget on an interstitial /
 * redirect / mobile-app push (Isracard CI run `25633964342`,
 * runId `10-05-2026_16381614`).
 *
 * <p>M4.F1.fix relaxes the URL-change requirement when strong auth
 * corroboration is present. Same-URL SPAs (Isracard `/StatusPage`)
 * legitimately serve both login and dashboard from one URL — but an
 * interstitial would not also produce a discovered Bearer token OR a
 * captured first-party well-known account-data API response
 * (`hasAuthApiResponse`). An unauthenticated page never makes the authed
 * data fetch, whereas a same-URL authed SPA does. So when REVEAL matched
 * AND either an authToken exists OR `hasAuthApiResponse` is true, URL-
 * change is no longer required. PR #221 CI run `25652060222` evidenced
 * authToken + REVEAL agreeing while currentUrl===preAuthUrl.
 *
 * <p>M4.F2.fix relaxes the REVEAL requirement — narrowly. The
 * visible-text REVEAL probe is timing-sensitive — a slow Angular
 * post-login redirect (Yahav/BaNCS `#/main/home`) paints the shell after
 * the probe budget, so REVEAL can miss on a page that is genuinely
 * authenticated. When REVEAL misses, the gate no longer hard-fails: it
 * opens ONLY on `hasAuthApiResponse` — a captured authed data response
 * verified by SHAPE (2xx + JSON + BaNCS `DataEntity[]`) that an
 * interstitial cannot forge. A bare authToken is NOT sufficient when
 * REVEAL also missed — a token can be captured mid-login on a page that
 * never reached the dashboard (Isracard CI `25633964342`), so token-alone
 * must still fail closed here. Cookie count / URL change alone are
 * likewise excluded (both previously false-passed and were removed).
 *
 * <p>Pure predicate — no I/O, no side effects. Caller resolves the
 * URL inputs (mediator + LOGIN emit) and threads them in. Mock /
 * test paths supply `preAuthUrl === ''` to opt out of the URL gate
 * while still asserting the REVEAL gate.
 */

import type { IAuthDiscovery } from '../../Types/PipelineContext.js';

/** Closed list of reasons the gate emits — matches the closed list pattern used by AuthDiscoveryFailCode. */
type DashboardGateReason = 'open' | 'reveal-missing' | 'url-stuck';

/**
 * Returns true when the slim snapshot carries either a discovered
 * Bearer token OR a captured first-party well-known account-data API
 * response (`hasAuthApiResponse`). An interstitial / unauthenticated
 * page never makes the authed data fetch, whereas a same-URL authed SPA
 * (Isracard `/StatusPage`) does. Defence-in-depth companion to the
 * URL-change signal — required only when `currentUrl === preAuthUrl`
 * for the gate to still open.
 *
 * @param snap - Slim {@link IAuthDiscovery} value committed by POST.
 * @returns True iff at least one strong auth signal is present.
 */
function hasStrongAuthCorroboration(snap: IAuthDiscovery): boolean {
  if (snap.authToken !== false) return true;
  return snap.hasAuthApiResponse;
}

/**
 * URL-only branch of {@link dashboardGateReason}: assumes REVEAL has
 * already matched. Returns `'open'` when any URL-side signal (change,
 * empty pre-auth, strong auth corroboration) clears the gate.
 *
 * @param snap - Slim auth-discovery snapshot.
 * @param currentUrl - Page URL at AUTH-DISCOVERY.FINAL entry.
 * @param preAuthUrl - URL emitted by LOGIN.PRE.
 * @returns Reason enum value.
 */
function urlBasedGateReason(
  snap: IAuthDiscovery,
  currentUrl: string,
  preAuthUrl: string,
): DashboardGateReason {
  if (preAuthUrl === '') return 'open';
  if (currentUrl !== preAuthUrl) return 'open';
  if (hasStrongAuthCorroboration(snap)) return 'open';
  return 'url-stuck';
}

/**
 * REVEAL-missing branch of {@link dashboardGateReason}. The visible-text
 * REVEAL probe is timing-sensitive — a slow Angular post-login redirect
 * (Yahav/BaNCS `#/main/home`) paints the shell after the probe budget, so
 * a REVEAL miss must not by itself veto a login the network already
 * corroborates. Opens ONLY on `hasAuthApiResponse`: a captured, authed,
 * first-party account-data response verified by SHAPE (2xx + JSON + BaNCS
 * `DataEntity[]` envelope) that an interstitial / unauthenticated page
 * cannot forge. A bare `authToken` is deliberately NOT sufficient here —
 * a token can be captured mid-login on a page that never reached the
 * dashboard (Isracard CI `25633964342`), so when REVEAL also missed,
 * token-alone still fails closed. No cookie-count or URL-change-alone
 * signal (both proven to false-pass and deliberately excluded).
 *
 * @param snap - Slim {@link IAuthDiscovery} value committed by POST.
 * @returns `'open'` on a shape-verified authed API response, else
 *   `'reveal-missing'`.
 */
function revealMissingGateReason(snap: IAuthDiscovery): DashboardGateReason {
  if (snap.hasAuthApiResponse) return 'open';
  return 'reveal-missing';
}

/**
 * Diagnostic version of {@link passesDashboardGate}. Returns the
 * specific reason the gate decided open / closed so the FINAL
 * orchestrator can log a targeted telemetry line without a second
 * conditional. `'open'` means signals agreed. When REVEAL matched, the
 * URL branch decides; when REVEAL missed, a shape-verified authed API
 * response decides ({@link revealMissingGateReason}).
 *
 * @param snap - Slim {@link IAuthDiscovery} value committed by POST.
 * @param currentUrl - Page URL at AUTH-DISCOVERY.FINAL entry.
 * @param preAuthUrl - URL emitted by LOGIN.PRE.
 * @returns Reason enum value.
 */
function dashboardGateReason(
  snap: IAuthDiscovery,
  currentUrl: string,
  preAuthUrl: string,
): DashboardGateReason {
  if (!snap.dashboardReady) return revealMissingGateReason(snap);
  return urlBasedGateReason(snap, currentUrl, preAuthUrl);
}

/**
 * Dashboard gate. Returns true when the auth-discovery signals agree
 * that an authenticated dashboard was reached: REVEAL matched AND the
 * page navigated (or same-URL SPA with strong corroboration), OR — when
 * REVEAL missed on a slow redirect — a shape-verified authed API
 * response alone ({@link revealMissingGateReason}).
 *
 * @param snap - Slim {@link IAuthDiscovery} value committed by POST.
 * @param currentUrl - Page URL at AUTH-DISCOVERY.FINAL entry.
 * @param preAuthUrl - URL emitted by LOGIN.PRE (the page where
 *   credentials were about to be submitted). Empty string disables
 *   the URL gate (test / mock paths where no live page exists).
 * @returns True when the gate opens.
 */
function passesDashboardGate(
  snap: IAuthDiscovery,
  currentUrl: string,
  preAuthUrl: string,
): boolean {
  return dashboardGateReason(snap, currentUrl, preAuthUrl) === 'open';
}

export type { DashboardGateReason };
export { dashboardGateReason, passesDashboardGate };
