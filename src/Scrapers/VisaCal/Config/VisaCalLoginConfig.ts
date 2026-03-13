import type { Frame, Page } from 'playwright';

import {
  clickButton,
  waitUntilElementFound,
  waitUntilIframeFound,
} from '../../../Common/ElementsInteractions.js';
import { waitForNavigation } from '../../../Common/Navigation.js';
import { CompanyTypes } from '../../../Definitions.js';
import type { ILoginConfig } from '../../Base/Config/LoginConfig.js';
import type { LifecyclePromise } from '../../Base/Interfaces/CallbackTypes.js';
import { SCRAPER_CONFIGURATION } from '../../Registry/Config/ScraperConfig.js';
import {
  CONNECT_IFRAME_OPTS,
  hasChangePasswordForm,
  hasInvalidPasswordError,
  isConnectFrame,
} from '../VisaCalHelpers.js';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.VisaCal];

/** Selector for the VisaCal login button on the main page. */
const LOGIN_BTN_SEL = '#ccLoginDesktopBtn';

/** Selector for the regular login option in the iframe. */
const REGULAR_LOGIN_SEL = '#regular-login';

/**
 * Wait for the VisaCal login button to appear on the page.
 * @param page - The Playwright page instance.
 * @returns True when the login button is found.
 */
async function visaCalCheckReadiness(page: Page): LifecyclePromise {
  await waitUntilElementFound(page, LOGIN_BTN_SEL);
}

/**
 * Open the VisaCal login popup and navigate to the login form inside the iframe.
 * @param page - The Playwright page instance.
 * @returns The iframe Frame containing the login form.
 */
async function visaCalOpenLoginPopup(page: Page): Promise<Frame> {
  await waitUntilElementFound(page, LOGIN_BTN_SEL, { visible: true });
  await clickButton(page, LOGIN_BTN_SEL);
  const frame = await waitUntilIframeFound(page, isConnectFrame, CONNECT_IFRAME_OPTS);
  await waitUntilElementFound(frame, REGULAR_LOGIN_SEL, { timeout: 30000 });
  await clickButton(frame, REGULAR_LOGIN_SEL);
  await waitUntilElementFound(frame, '[formcontrolname="userName"]', { timeout: 45000 });
  return frame;
}

/**
 * Wait for VisaCal post-login navigation to complete.
 * @param page - The Playwright page instance.
 * @returns True when post-login navigation completes.
 */
async function visaCalPostAction(page: Page): LifecyclePromise {
  const isAlreadyLoggedIn = page.url().includes('cal-online.co.il/#');
  if (!isAlreadyLoggedIn) {
    await waitForNavigation(page);
  }
}

/** Declarative login configuration for VisaCal. */
export const VISACAL_LOGIN_CONFIG: ILoginConfig = {
  loginUrl: CFG.urls.base,
  fields: [
    { credentialKey: 'username', selectors: [] },
    { credentialKey: 'password', selectors: [] },
  ],
  submit: [{ kind: 'textContent', value: 'כניסה' }],
  checkReadiness: visaCalCheckReadiness,
  preAction: visaCalOpenLoginPopup,
  postAction: visaCalPostAction,
  possibleResults: {
    success: [/dashboard/i, /cal-online\.co\.il\/#/],
    invalidPassword: [
      async (opts?: { page?: Page }): Promise<boolean> =>
        opts?.page ? hasInvalidPasswordError(opts.page) : false,
    ],
    changePassword: [
      async (opts?: { page?: Page }): Promise<boolean> =>
        opts?.page ? hasChangePasswordForm(opts.page) : false,
    ],
  },
};

export default VISACAL_LOGIN_CONFIG;
