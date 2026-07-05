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
