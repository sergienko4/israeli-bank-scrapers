/**
 * Amex (American Express Israel) login lifecycle hooks.
 *
 * ARCHITECTURAL NOTES:
 *   - No Connect iframe: the login form is directly on the page at /personalarea/Login.
 *     preAction is therefore NOT required (contrast with VisaCal which needs visaCalOpenLoginPopup).
 *   - checkReadiness: waits for the page to reach 'load' state so WellKnown resolution
 *     finds the Hebrew text inputs (תעודת זהות, סיסמה, 6 ספרות).
 *   - postAction: after form submit, the SPA navigates away from /Login to the personal area
 *     dashboard. We guard on URL change, NOT networkidle — this avoids the "Hapoalim
 *     False Timeout" pattern where networkidle never fires on SPA state transitions.
 *
 * WELL-KNOWN MEDIATOR MAP (Amex Israel):
 *   Field          | Hebrew visible text          | WK key     | Resolved by
 *   ───────────────┼──────────────────────────────┼────────────┼──────────────────────────
 *   Israeli ID     | תעודת זהות / מספר זהות       | id         | PIPELINE_WELL_KNOWN_LOGIN.id
 *   Password       | סיסמה / קוד סודי             | password   | PIPELINE_WELL_KNOWN_LOGIN.password
 *   Card 6 digits  | 6 ספרות / ספרות הכרטיס       | card6Digits| PIPELINE_WELL_KNOWN_LOGIN.card6Digits
 *
 * Rule #10: Zero direct Playwright selectors in the bank Pipeline file.
 *           These hooks live here (infrastructure layer), not in AmexPipeline.ts.
 */

import type { Page } from 'playwright-core';

import type { LifecyclePromise } from '../../Base/Interfaces/CallbackTypes.js';
import { waitForFirstField } from '../../Pipeline/Phases/GenericPreLoginSteps.js';

/** URL substring that identifies the Amex login page. */
const AMEX_LOGIN_ROUTE = '/personalarea/Login';

/** Timeout for post-login SPA navigation (ms). */
const POST_LOGIN_NAV_TIMEOUT = 30_000;

/**
 * Wait for the Amex login form fields to become visible.
 * Reuses the generic WellKnown field-presence check — no Amex-specific selectors.
 * @param page - Playwright page at the login URL.
 * @returns Resolves when a credential field is visible.
 */
export async function amexCheckReadiness(page: Page): LifecyclePromise {
  await waitForFirstField(page);
}

/**
 * Wait for the post-login SPA navigation away from the login page.
 * Guards on URL change (not networkidle) to avoid false-timeout on SPA transitions.
 * @param page - Playwright page after form submission.
 * @returns Resolves when navigation to the personal area completes.
 */
export async function amexPostLogin(page: Page): LifecyclePromise {
  const hasNavigatedAway = !page.url().includes(AMEX_LOGIN_ROUTE);
  if (!hasNavigatedAway) {
    await page
      .waitForURL(url => !url.pathname.includes('Login'), {
        timeout: POST_LOGIN_NAV_TIMEOUT,
      })
      .catch(() => undefined); // non-fatal — postLogin in LoginSteps will detect errors
  }
}
