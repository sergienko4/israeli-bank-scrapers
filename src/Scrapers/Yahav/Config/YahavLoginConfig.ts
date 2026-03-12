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

/**
 * Yahav post-login action — waits for loader, dismisses messaging, and waits for dashboard.
 * @param page - The Playwright page instance.
 * @returns True when post-login actions complete.
 */
async function yahavPostAction(page: Page): LifecyclePromise {
  await waitForNavigation(page);
  await waitUntilElementDisappear(page, '.loader');
  if (await elementPresentOnPage(page, '.messaging-links-container')) {
    await page.$eval('.link-1', el => {
      (el as HTMLElement).click();
    });
  }
  await Promise.race([
    waitUntilElementFound(page, '#AccountDetails'),
    waitUntilElementFound(page, 'input#ef_req_parameter_old_credential'),
  ]);
}

/** Company type for Yahav — re-exported for module multi-export compliance. */
export const YAHAV_COMPANY = CompanyTypes.Yahav;

/** Declarative login configuration for Bank Yahav. */
export const YAHAV_CONFIG: ILoginConfig = {
  loginUrl: CFG.urls.base,
  fields: [
    { credentialKey: 'username', selectors: [] }, // wellKnown → #username
    { credentialKey: 'password', selectors: [] }, // wellKnown → #password
    { credentialKey: 'nationalID', selectors: [] }, // wellKnown → #pinno
  ],
  submit: [{ kind: 'css', value: '.btn' }],
  /**
   * Wait for login form fields and submit button to appear.
   * @param page - The Playwright page instance.
   * @returns True when login form is ready.
   */
  checkReadiness: async (page: Page): LifecyclePromise => {
    const pinnoReady = waitUntilElementFound(page, '#pinno');
    const btnReady = waitUntilElementFound(page, '.btn');
    await Promise.all([pinnoReady, btnReady]);
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
