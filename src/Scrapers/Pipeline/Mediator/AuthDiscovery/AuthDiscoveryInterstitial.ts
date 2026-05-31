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
 * Both must be true to commit. Either one false ⇒ AUTH-DISCOVERY.FINAL
 * fails loud with `AUTH_DISCOVERY_DASHBOARD_NOT_READY`, so DASHBOARD.PRE
 * never wastes its 122 s resolver budget on an interstitial /
 * redirect / mobile-app push (Isracard CI run `25633964342`,
 * runId `10-05-2026_16381614`).
 *
 * <p>M4.F1.fix relaxes the URL-change requirement when strong auth
 * corroboration is present. Same-URL SPAs (Isracard `/StatusPage`)
 * legitimately serve both login and dashboard from one URL — but
 * an interstitial would not also produce a discovered Bearer token
 * or a multi-cookie session. So when REVEAL matched AND either an
 * authToken exists OR ≥ {@link STRONG_AUTH_COOKIE_FLOOR} session
 * cookies were captured, URL-change is no longer required. PR #221
 * CI run `25652060222` evidenced 60 post-auth cookies + authToken
 * + REVEAL all agreeing while currentUrl===preAuthUrl.
 *
 * <p>Pure predicate — no I/O, no side effects. Caller resolves the
 * URL inputs (mediator + LOGIN emit) and threads them in. Mock /
 * test paths supply `preAuthUrl === ''` to opt out of the URL gate
 * while still asserting the REVEAL gate.
 */

import type { IAuthDiscovery } from '../../Types/PipelineContext.js';
import { STRONG_AUTH_COOKIE_FLOOR } from '../Timing/TimingConfig.js';

/** Closed list of reasons the gate emits — matches the closed list pattern used by AuthDiscoveryFailCode. */
type DashboardGateReason = 'open' | 'reveal-missing' | 'url-stuck';

/**
 * Returns true when the slim snapshot carries either a discovered
 * Bearer token OR enough post-auth session cookies that the REVEAL
 * match cannot plausibly come from an interstitial. Defence-in-depth
 * companion to the URL-change signal — required only when
 * `currentUrl === preAuthUrl` for the gate to still open.
 *
 * @param snap - Slim {@link IAuthDiscovery} value committed by POST.
 * @returns True iff at least one strong auth signal is present.
 */
function hasStrongAuthCorroboration(snap: IAuthDiscovery): boolean {
  if (snap.authToken !== false) return true;
  return snap.sessionCookieNames.length >= STRONG_AUTH_COOKIE_FLOOR;
}

/**
 * Diagnostic version of {@link passesDashboardGate}. Returns the
 * specific reason the gate decided open / closed so the FINAL
 * orchestrator can log a targeted telemetry line without a second
 * conditional. `'open'` means signals agreed.
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
  if (!snap.dashboardReady) return 'reveal-missing';
  if (preAuthUrl === '') return 'open';
  if (currentUrl !== preAuthUrl) return 'open';
  if (hasStrongAuthCorroboration(snap)) return 'open';
  return 'url-stuck';
}

/**
 * Two-signal dashboard gate. Returns true only when REVEAL matched
 * AND the page navigated away from the URL LOGIN.PRE captured.
 *
 * @param snap - Slim {@link IAuthDiscovery} value committed by POST.
 * @param currentUrl - Page URL at AUTH-DISCOVERY.FINAL entry.
 * @param preAuthUrl - URL emitted by LOGIN.PRE (the page where
 *   credentials were about to be submitted). Empty string disables
 *   the URL gate (test / mock paths where no live page exists).
 * @returns True when both signals are green.
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
