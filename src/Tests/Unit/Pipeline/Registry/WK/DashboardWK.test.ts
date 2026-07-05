/**
 * DashboardWK.REVEAL — pin the dashboard-ready reveal anchors.
 *
 * Regression guard (live real-E2E, 2026-07-05): Leumi reached its authed
 * dashboard, but the ONLY Leumi-matching REVEAL entry was the data-gated
 * "כניסתך האחרונה" last-login regex, which Angular paints late — so the
 * auth-discovery reveal probe fired first → "no reveal" →
 * AUTH_DISCOVERY_DASHBOARD_NOT_READY. This pins Leumi's stable SPA-shell
 * anchors ("תנועות בחשבון") in REVEAL so the reveal no longer depends solely
 * on the late-rendering last-login widget.
 */

import { buildRevealCandidates } from '../../../../../Scrapers/Pipeline/Mediator/Dashboard/DashboardDiscovery.js';
import { isTxnPageUrl } from '../../../../../Scrapers/Pipeline/Registry/WK/DashboardTxnMatch.js';

/**
 * Whether the production REVEAL candidate builder emits a candidate whose
 * visible-text value equals `value`. Driving through the real builder (not a
 * re-check of the WK array) ties this guard to how the runtime actually
 * consumes WK_DASHBOARD.REVEAL, so a drift in that consumption fails here.
 * @param value - Literal reveal anchor text.
 * @returns True iff the production-built candidate list carries it.
 */
function revealBuildsText(value: string): boolean {
  return buildRevealCandidates().some((candidate): boolean => candidate.value === value);
}

describe('WK_DASHBOARD.REVEAL — Leumi stable shell anchor', () => {
  it('pins the Leumi account-movements shell anchor "תנועות בחשבון"', () => {
    const hasMovements = revealBuildsText('תנועות בחשבון');
    expect(hasMovements).toBe(true);
  });
});

/**
 * Regression guard (live real-E2E, 2026-07-05): Max reached its dashboard and
 * its real txn data endpoint `…/transactionDetails/getTransactionsAndGraphs`
 * fired 200 but the current billing cycle was empty (0 records). The picker had
 * no URL pattern for it, so it depended on response shape (records present) —
 * which an empty cycle lacks — and fail-loud'd DASHBOARD_TXN_FIELDMAP_INCOMPLETE.
 * This pins the Max URL pattern so the empty capture is picked by URL and the
 * SCRAPE phase re-fetches the historical range.
 */
describe('WK_DASHBOARD.TXN_PAGE_PATTERNS — Max txn endpoint', () => {
  it('matches the Max getTransactionsAndGraphs data endpoint (empty-cycle safe)', () => {
    const url =
      'https://www.max.co.il/api/registered/transactionDetails/getTransactionsAndGraphs?v=V4';
    const isMatched = isTxnPageUrl(url);
    expect(isMatched).toBe(true);
  });

  it('does not match an unrelated Max endpoint (default-deny)', () => {
    const url = 'https://www.max.co.il/api/registered/spreadTransaction/getContents';
    const isMatched = isTxnPageUrl(url);
    expect(isMatched).toBe(false);
  });
});
