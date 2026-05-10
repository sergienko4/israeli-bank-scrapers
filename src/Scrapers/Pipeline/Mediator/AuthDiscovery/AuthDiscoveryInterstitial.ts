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
 * <p>Pure predicate — no I/O, no side effects. Caller resolves the
 * URL inputs (mediator + LOGIN emit) and threads them in. Mock /
 * test paths supply `preAuthUrl === ''` to opt out of the URL gate
 * while still asserting the REVEAL gate.
 */

import type { IAuthDiscovery } from '../../Types/PipelineContext.js';

/** Closed list of reasons the gate emits — matches the closed list pattern used by AuthDiscoveryFailCode. */
type DashboardGateReason = 'open' | 'reveal-missing' | 'url-stuck';

/**
 * Diagnostic version of {@link passesDashboardGate}. Returns the
 * specific reason the gate decided open / closed so the FINAL
 * orchestrator can log a targeted telemetry line without a second
 * conditional. `'open'` means both signals agreed.
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
  if (currentUrl === preAuthUrl) return 'url-stuck';
  return 'open';
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
