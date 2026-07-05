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

import { WK_DASHBOARD } from '../../../../../Scrapers/Pipeline/Registry/WK/DashboardWK.js';

/** A WK reveal entry shape (just the bits this test asserts on). */
interface IRevealEntry {
  readonly kind: string;
  readonly value: string;
}

/**
 * Whether REVEAL carries a `textContent` match for `value`.
 * @param value - Literal reveal text.
 * @returns True iff present as a textContent reveal anchor.
 */
function revealHasText(value: string): boolean {
  return WK_DASHBOARD.REVEAL.some(
    (entry: IRevealEntry): boolean => entry.kind === 'textContent' && entry.value === value,
  );
}

describe('WK_DASHBOARD.REVEAL — Leumi stable shell anchor', () => {
  it('pins the Leumi account-movements shell anchor "תנועות בחשבון"', () => {
    const hasMovements = revealHasText('תנועות בחשבון');
    expect(hasMovements).toBe(true);
  });
});

/**
 * Whether any TXN_PAGE_PATTERN matches `url`.
 * @param url - Captured response URL.
 * @returns True iff the DASHBOARD txn-endpoint picker would URL-match it.
 */
function anyTxnPatternMatches(url: string): boolean {
  return WK_DASHBOARD.TXN_PAGE_PATTERNS.some((re: RegExp): boolean => re.test(url));
}

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
    const isMatched = anyTxnPatternMatches(url);
    expect(isMatched).toBe(true);
  });

  it('does not match an unrelated Max endpoint (default-deny)', () => {
    const url = 'https://www.max.co.il/api/registered/spreadTransaction/getContents';
    const isMatched = anyTxnPatternMatches(url);
    expect(isMatched).toBe(false);
  });
});
