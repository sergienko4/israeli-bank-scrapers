/**
 * Isracard login lifecycle hooks — INDEPENDENT from AmexLoginConfig.
 *
 * INDEPENDENT PIPELINES (per architectural mandate):
 *   Amex    → waitForURL guard (SPA navigates to a new route after login)
 *   Isracard → waitForSelector guard + popup dismiss (may stay on same URL)
 *
 * ISRACARD WELL-KNOWN MEDIATOR MAP:
 *   ┌───────────┬────────────────────────────────┬─────────────────┐
 *   │ Field     │ Hebrew visible text             │ credentialKey   │
 *   ├───────────┼────────────────────────────────┼─────────────────┤
 *   │ ID        │ תעודת זהות / מספר זהות          │ id              │
 *   │ Password  │ סיסמה / קוד כניסה               │ password        │
 *   │ Card 6    │ 6 ספרות / ספרות הכרטיס          │ card6Digits     │
 *   └───────────┴────────────────────────────────┴─────────────────┘
 *
 * ISRACARD POST-LOGIN BEHAVIOUR:
 *   After login the portal may display a welcome overlay/popup while
 *   remaining on the same URL. Unlike Amex (waitForURL is sufficient),
 *   Isracard requires:
 *     1. waitForSelector on a dashboard element (login confirmation)
 *     2. Dismiss any welcome popup by clicking its close button (visible Hebrew text)
 *
 * PII SHIELD:
 *   card6Digits  → covered by SENSITIVE_PATHS → '[REDACTED]' in all logs
 *   cardNumber   → 4 chars → length exception → visible (safe for debug)
 *   Any future isracardToken/sessionKey → add to WL_SENSITIVE_KEYS in DebugConfig.ts
 *
 * Rule #10: These hooks live in Config (infrastructure layer), not in IsracardPipeline.ts.
 *           Direct Playwright calls here follow the same pattern as VisaCalLoginConfig.ts.
 */

import type { Page } from 'playwright-core';

import type { LifecyclePromise } from '../../Base/Interfaces/CallbackTypes.js';

/** URL substring identifying the Isracard login page. */
const ISRACARD_LOGIN_ROUTE = '/personalarea/Login';

/** Dashboard indicator text — confirms the user landed on the personal area. */
const DASHBOARD_INDICATOR = 'עסקאות';

/** Timeout waiting for dashboard to appear after login (ms). */
const DASHBOARD_WAIT_MS = 35_000;

/**
 * Candidate close-button texts for Isracard welcome popups.
 * Ordered: most specific first (Hebrew close > generic Latin).
 */
const POPUP_CLOSE_TEXTS = ['סגור', 'ביטול', 'המשך', 'close', 'OK'];

/**
 * Wait for the Isracard login form to reach DOM-ready state.
 * Uses domcontentloaded — the form renders synchronously on this portal.
 * @param page - Playwright page at /personalarea/Login.
 * @returns Resolves when the DOM is ready.
 */
export async function isracardCheckReadiness(page: Page): LifecyclePromise {
  await page.waitForLoadState('domcontentloaded');
}

/**
 * Attempt to close a welcome popup by clicking its visible Hebrew/Latin text button.
 * Guard-clause style — no else, no ternary.
 * @param page - Playwright page after login.
 * @returns Resolves after attempting to close any popup.
 */
async function dismissWelcomePopup(page: Page): LifecyclePromise {
  // Check all candidates in parallel (no-await-in-loop), click the first visible one
  const locators = POPUP_CLOSE_TEXTS.map(text => page.getByText(text, { exact: true }).first());
  const visibilityChecks = locators.map(btn => btn.isVisible().catch(() => false));
  const visibilities = await Promise.all(visibilityChecks);
  const visibleBtn = locators.find((_, i) => visibilities[i]);
  if (visibleBtn) {
    await visibleBtn.click().catch(() => undefined);
  }
}

/**
 * Post-login handler for Isracard.
 *
 * Uses waitForSelector (not waitForURL) because the Isracard portal may remain
 * on the same pathname while the SPA renders the dashboard view.
 *
 * Guard-clause structure — no else blocks, no ternary operators:
 *   1. Already past login → return immediately (idempotent)
 *   2. Wait for dashboard indicator selector to confirm login success
 *   3. Dismiss any welcome popup via visible Hebrew text
 *
 * @param page - Playwright page after form submission.
 * @returns Resolves when the dashboard is ready and any popup is dismissed.
 */
export async function isracardPostLogin(page: Page): LifecyclePromise {
  const hasNavigatedAway = !page.url().includes(ISRACARD_LOGIN_ROUTE);
  if (!hasNavigatedAway) {
    // Step 1: wait for a dashboard-specific element to confirm login success
    await page
      .getByText(DASHBOARD_INDICATOR)
      .first()
      .waitFor({ state: 'visible', timeout: DASHBOARD_WAIT_MS })
      .catch(() => undefined); // non-fatal — postLogin in LoginSteps checks form errors

    // Step 2: dismiss welcome overlay if present (visible text, no CSS selectors)
    await dismissWelcomePopup(page);
  }
}
