import { type Page } from 'playwright';

import {
  elementPresentOnPage,
  waitUntilElementDisappear,
  waitUntilElementFound,
} from '../../../Common/ElementsInteractions.js';
import { waitForNavigation } from '../../../Common/Navigation.js';
import { CompanyTypes } from '../../../Definitions.js';
import { type ILoginConfig } from '../../Base/Config/LoginConfig.js';
import type { LifecyclePromise } from '../../Base/Interfaces/CallbackTypes.js';
import { SCRAPER_CONFIGURATION } from '../../Registry/Config/ScraperConfig.js';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Yahav];

/** Playwright selector for the loading spinner (role-based). */
const LOADER_SEL = 'role=progressbar';

/** Playwright selector for the messaging overlay container. */
const MESSAGING_SEL = 'text=הודעות';

/** Playwright selector for the messaging dismiss link. */
const DISMISS_LINK_SEL = 'role=link[name="אישור"]';

/** Playwright selector for post-login account details. */
const DASHBOARD_SEL = 'text=פרטי חשבון';

/** Playwright selector for the change-password form. */
const CHANGE_PASSWORD_SEL = '[name="ef_req_parameter_old_credential"]';

/**
 * Yahav post-login action — waits for loader, dismisses messaging, and waits for dashboard.
 * @param page - The Playwright page instance.
 * @returns True when post-login actions complete.
 */
async function yahavPostAction(page: Page): LifecyclePromise {
  await waitForNavigation(page);
  await waitUntilElementDisappear(page, LOADER_SEL);
  if (await elementPresentOnPage(page, MESSAGING_SEL)) {
    await page.locator(DISMISS_LINK_SEL).first().click();
  }
  await Promise.race([
    waitUntilElementFound(page, DASHBOARD_SEL),
    waitUntilElementFound(page, CHANGE_PASSWORD_SEL),
  ]);
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
  submit: [{ kind: 'textContent', value: 'כניסה' }],
  /**
   * Wait for login form fields and submit button to appear.
   * @param page - The Playwright page instance.
   * @returns True when login form is ready.
   */
  checkReadiness: async (page: Page): LifecyclePromise => {
    const pinnoReady = waitUntilElementFound(page, '[name="pinno"]');
    const btnReady = waitUntilElementFound(page, 'role=button[name="כניסה"]');
    await Promise.all([pinnoReady, btnReady]);
  },
  postAction: yahavPostAction,
  possibleResults: {
    success: ['https://digital.yahav.co.il/BaNCSDigitalUI/app/index.html#/main/home'],
    invalidPassword: [
      async (opts): Promise<boolean> =>
        !!(opts?.page && (await elementPresentOnPage(opts.page, 'role=dialog >> role=button'))),
    ],
    changePassword: [
      async (opts): Promise<boolean> =>
        !!(opts?.page && (await elementPresentOnPage(opts.page, CHANGE_PASSWORD_SEL))),
    ],
  },
};
