import { type Page } from 'playwright-core';

import { elementPresentOnPage } from '../../../Common/ElementsInteractions.js';
import { waitForNavigation } from '../../../Common/Navigation.js';
import { CompanyTypes } from '../../../Definitions.js';
import { type ILoginConfig } from '../../Base/Config/LoginConfig.js';
import type { LifecyclePromise } from '../../Base/Interfaces/CallbackTypes.js';
import { SCRAPER_CONFIGURATION } from '../../Registry/Config/ScraperConfig.js';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Yahav];

/**
 * No-op catch handler for timeout errors in post-login waits.
 * @returns False to indicate no indicator was found.
 */
function ignoreTimeout(): boolean {
  return false;
}

/** Hebrew text for the account details heading. */
const ACCOUNT_DETAILS_TEXT = 'פרטי חשבון';

/** Submit button text on the Yahav login form. */
const SUBMIT_TEXT = 'כניסה';

/**
 * Dismiss the messaging popup if present by clicking its first link.
 * @param page - The Playwright page instance.
 * @returns True if dismissed, false if not present.
 */
/** Hebrew dismiss button texts for messaging popups. */
const DISMISS_TEXTS = ['סגור', 'הבנתי', 'אישור', 'המשך'];

/**
 * Check visibility of a dismiss text candidate.
 * @param page - The Playwright page.
 * @param text - The dismiss text to check.
 * @returns True if the text is visible.
 */
async function isDismissVisible(page: Page, text: string): Promise<boolean> {
  return page
    .getByText(text)
    .first()
    .isVisible()
    .catch(() => false);
}

/**
 * Dismiss the messaging popup if present by clicking the first visible dismiss text.
 * @param page - The Playwright page instance.
 * @returns True if dismissed, false if not present.
 */
async function dismissMessaging(page: Page): Promise<boolean> {
  const tasks = DISMISS_TEXTS.map(t => isDismissVisible(page, t));
  const checks = await Promise.all(tasks);
  const idx = checks.findIndex(Boolean);
  if (idx < 0) return false;
  await page.getByText(DISMISS_TEXTS[idx]).first().click();
  return true;
}

/**
 * Yahav post-login action — waits for loader, dismisses messaging, and waits for dashboard.
 * @param page - The Playwright page instance.
 * @returns True when post-login actions complete.
 */
async function yahavPostAction(page: Page): LifecyclePromise {
  await waitForNavigation(page);
  await page.waitForLoadState('networkidle').catch(ignoreTimeout);
  await dismissMessaging(page);
  await Promise.any([
    page.getByText(ACCOUNT_DETAILS_TEXT).first().waitFor({ state: 'visible', timeout: 60000 }),
    page.getByText('שינוי סיסמה').first().waitFor({ state: 'visible', timeout: 60000 }),
  ]).catch(ignoreTimeout);
}

/** Company type for Yahav — re-exported for module multi-export compliance. */
export const YAHAV_COMPANY = CompanyTypes.Yahav;

/** Declarative login configuration for Bank Yahav. */
export const YAHAV_CONFIG: ILoginConfig = {
  loginUrl: CFG.urls.base,
  fields: [
    { credentialKey: 'username', selectors: [] },
    { credentialKey: 'password', selectors: [] },
    { credentialKey: 'nationalID', selectors: [] },
  ],
  submit: [{ kind: 'textContent', value: SUBMIT_TEXT }],
  /**
   * Wait for login form fields and submit button to appear.
   * @param page - The Playwright page instance.
   * @returns True when login form is ready.
   */
  checkReadiness: async (page: Page): LifecyclePromise => {
    const pwReady = page.locator('input[type="password"]').first().waitFor({ state: 'visible' });
    const btnReady = page.getByText(SUBMIT_TEXT).first().waitFor({ state: 'visible' });
    await Promise.all([pwReady, btnReady]);
  },
  postAction: yahavPostAction,
  possibleResults: {
    success: ['https://digital.yahav.co.il/BaNCSDigitalUI/app/index.html#/main/home'],
    invalidPassword: [
      async (opts): Promise<boolean> =>
        !!(opts?.page && (await elementPresentOnPage(opts.page, '.ui-dialog-buttons'))),
    ],
    changePassword: [
      async (opts): Promise<boolean> =>
        !!(
          opts?.page &&
          (await elementPresentOnPage(opts.page, 'input#ef_req_parameter_old_credential'))
        ),
    ],
  },
};
