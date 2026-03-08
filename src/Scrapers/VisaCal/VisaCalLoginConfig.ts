import type { Frame, Page } from 'playwright';

import {
  clickButton,
  waitUntilElementFound,
  waitUntilIframeFound,
} from '../../Common/ElementsInteractions.js';
import { waitForNavigation } from '../../Common/Navigation.js';
import { CompanyTypes } from '../../Definitions.js';
import type { LoginConfig } from '../Base/LoginConfig.js';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig.js';
import {
  CONNECT_IFRAME_OPTS,
  hasChangePasswordForm,
  hasInvalidPasswordError,
  isConnectFrame,
} from './VisaCalHelpers.js';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.VisaCal];

async function visaCalCheckReadiness(page: Page): Promise<void> {
  await waitUntilElementFound(page, '#ccLoginDesktopBtn');
}

async function visaCalOpenLoginPopup(page: Page): Promise<Frame> {
  await waitUntilElementFound(page, '#ccLoginDesktopBtn', { visible: true });
  await clickButton(page, '#ccLoginDesktopBtn');
  const frame = await waitUntilIframeFound(page, isConnectFrame, CONNECT_IFRAME_OPTS);
  await waitUntilElementFound(frame, '#regular-login', { timeout: 30000 });
  await clickButton(frame, '#regular-login');
  await waitUntilElementFound(frame, '[formcontrolname="userName"]', { timeout: 45000 });
  return frame;
}

async function visaCalPostAction(page: Page): Promise<void> {
  const isAlreadyLoggedIn = page.url().includes('cal-online.co.il/#');
  if (!isAlreadyLoggedIn) {
    await waitForNavigation(page);
  }
}

export const VISACAL_LOGIN_CONFIG: LoginConfig = {
  loginUrl: CFG.urls.base,
  fields: [
    { credentialKey: 'username', selectors: [] },
    { credentialKey: 'password', selectors: [] },
  ],
  submit: [{ kind: 'css', value: 'button[type="submit"]' }],
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
