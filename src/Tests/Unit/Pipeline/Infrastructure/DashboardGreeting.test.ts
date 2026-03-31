/**
 * Unit tests for dashboard greeting regex patterns.
 * Verifies that regex patterns match logged-in greetings but NOT nav/footer text.
 */

import { WK_LOGIN_SUCCESS } from '../../../../Scrapers/Pipeline/Registry/WK/LoginWK.js';

/** Extract regex candidates from dashboardIndicator. */
const REGEX_CANDIDATES = WK_LOGIN_SUCCESS.filter((c): boolean => c.kind === 'regex');

/**
 * Test if any regex candidate matches the given text.
 * @param text - Text to test.
 * @returns True if any regex matches.
 */
function matchesAnyGreeting(text: string): boolean {
  return REGEX_CANDIDATES.some((c): boolean => new RegExp(c.value).test(text));
}

describe('DashboardGreeting/regex', () => {
  it('has at least 3 regex patterns in WK.LOGIN.POST.SUCCESS', () => {
    expect(REGEX_CANDIDATES.length).toBeGreaterThanOrEqual(3);
  });

  // ── Should match (logged-in greetings) ──────────────────

  it.each([
    'היי ישראל, בוקר טוב!',
    'שלום ישראל',
    'שלום דוד כהן',
    'ברוך הבא, ישראל',
    'Hello, David',
    'Hello David',
  ])('matches logged-in greeting: "%s"', text => {
    const isMatch = matchesAnyGreeting(text);
    expect(isMatch).toBe(true);
  });

  // ── Should NOT match (nav/footer/generic text) ──────────

  it.each(['שלום', 'ברוך הבא לאתר', 'ברוך הבא ישראל', 'Hello', 'כניסה'])(
    'does NOT match generic text: "%s"',
    text => {
      const isMatch = matchesAnyGreeting(text);
      expect(isMatch).toBe(false);
    },
  );
});
