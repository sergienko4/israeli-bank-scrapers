import { type Page } from 'playwright-core';

import { type ILoginConfig } from '../../Base/Config/LoginConfig.js';
import { DOM_OTP } from '../../Registry/Config/ScraperConfigDefaults.js';
import { WELL_KNOWN_DASHBOARD_SELECTORS } from '../../Registry/WellKnownSelectors.js';

/**
 * Build text-based waiters from WELL_KNOWN dashboard categories.
 * @param page - The Playwright page to build waiters for.
 * @returns Array of promises that resolve when a dashboard element is visible.
 */
function buildDashboardWaiters(page: Page): Promise<boolean>[] {
  const candidates = [
    ...WELL_KNOWN_DASHBOARD_SELECTORS.logoutLink,
    ...WELL_KNOWN_DASHBOARD_SELECTORS.accountSelector,
    ...WELL_KNOWN_DASHBOARD_SELECTORS.dashboardIndicator,
  ];
  return candidates
    .filter(c => c.kind === 'textContent')
    .map(async c => {
      const loc = page.getByText(c.value).first();
      await loc.waitFor({ state: 'visible', timeout: 30000 });
      return true;
    });
}

/**
 * Wait for any of the known post-login dashboard selectors to appear.
 * @param page - The Playwright page to check for dashboard elements.
 * @returns True once the race completes.
 */
async function beinleumiPostAction(
  page: Page,
): ReturnType<NonNullable<ILoginConfig['postAction']>> {
  const waiters = buildDashboardWaiters(page);
  await Promise.race(waiters).catch(() => {
    // intentionally ignore timeout — any matched selector is sufficient
  });
}

/** Login field declarations for Beinleumi — wellKnown resolves #username and #password. */
export const BEINLEUMI_FIELDS: ILoginConfig['fields'] = [
  { credentialKey: 'username', selectors: [] }, // wellKnown → #username
  { credentialKey: 'password', selectors: [] }, // wellKnown → #password
];

const BEINLEUMI_SUBMIT: ILoginConfig['submit'] = [
  // wellKnown __submit__ provides 'המשך'/'כניסה' text-based fallbacks
];

const BEINLEUMI_POSSIBLE_RESULTS: ILoginConfig['possibleResults'] = {
  success: [/fibi.*accountSummary/, /Resources\/PortalNG\/shell/, /FibiMenu\/Online/],
  invalidPassword: [/FibiMenu\/Marketing\/Private\/Home/],
};

/**
 * Check if a single login text candidate is visible and click it.
 * @param page - The Playwright page.
 * @param text - The visible text to search for.
 * @returns True if the text was found and clicked.
 */
async function tryClickSingleText(page: Page, text: string): Promise<boolean> {
  const loc = page.getByText(text).first();
  const isTextVisible = await loc.isVisible().catch(() => false);
  if (!isTextVisible) return false;
  await loc.click();
  return true;
}

/**
 * Try clicking a login trigger by visible text from WELL_KNOWN loginLink.
 * @param page - The Playwright page.
 * @returns True if a login trigger was found and clicked.
 */
async function tryClickLoginTrigger(page: Page): Promise<boolean> {
  const textCandidates = WELL_KNOWN_DASHBOARD_SELECTORS.loginLink.filter(
    c => c.kind === 'textContent',
  );
  const loginTexts = textCandidates.map(c => c.value);
  const clickAttempts = loginTexts.map(t => tryClickSingleText(page, t));
  const results = await Promise.all(clickAttempts);
  return results.some(Boolean);
}

/**
 * Click the login trigger if present, then wait for the form to render.
 * @param page - The Playwright page to interact with.
 * @returns The login iframe if found, or undefined.
 */
async function beinleumiPreAction(page: Page): ReturnType<NonNullable<ILoginConfig['preAction']>> {
  const hasTrigger = await tryClickLoginTrigger(page);
  const waitMs = hasTrigger ? 2000 : 1000;
  await page.waitForTimeout(waitMs);
  return page.frames().find(f => f.url().includes('login'));
}

/**
 * Build the login configuration for Beinleumi bank.
 * @param loginUrl - The bank's login page URL.
 * @returns A complete ILoginConfig for the Beinleumi login flow.
 */
export function beinleumiConfig(loginUrl: string): ILoginConfig {
  return {
    loginUrl,
    fields: BEINLEUMI_FIELDS,
    submit: BEINLEUMI_SUBMIT,
    otp: DOM_OTP,
    preAction: beinleumiPreAction,
    postAction: beinleumiPostAction,
    possibleResults: BEINLEUMI_POSSIBLE_RESULTS,
  };
}
