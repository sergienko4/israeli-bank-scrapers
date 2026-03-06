import { type Page } from 'playwright';

import {
  elementPresentOnPage,
  waitUntilElementDisappear,
  waitUntilElementFound,
} from '../../Common/ElementsInteractions';
import { waitForNavigation } from '../../Common/Navigation';
import { CompanyTypes } from '../../Definitions';
import { type LoginConfig } from '../Base/LoginConfig';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Yahav];

/**
 * Post-login action for Yahav that waits for navigation and handles the welcome popup.
 *
 * @param page - the Playwright page after login form submission
 */
async function yahavPostAction(page: Page): Promise<void> {
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

export const YAHAV_CONFIG: LoginConfig = {
  loginUrl: CFG.urls.base,
  fields: [
    { credentialKey: 'username', selectors: [] }, // wellKnown → #username
    { credentialKey: 'password', selectors: [] }, // wellKnown → #password
    { credentialKey: 'nationalID', selectors: [] }, // wellKnown → #pinno
  ],
  submit: [{ kind: 'css', value: '.btn' }],
  /**
   * Waits for the Yahav national ID field and submit button to be present.
   *
   * @param page - the Playwright page showing the Yahav login form
   */
  checkReadiness: async (page: Page) => {
    await Promise.all([waitUntilElementFound(page, '#pinno'), waitUntilElementFound(page, '.btn')]);
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

export default YAHAV_CONFIG;
