import { type Page } from 'playwright';

import { waitForRedirect } from '../../../Common/Navigation.js';
import { CompanyTypes } from '../../../Definitions.js';
import { type ILoginConfig } from '../../Base/Config/LoginConfig.js';
import { SCRAPER_CONFIGURATION } from '../../Registry/Config/ScraperConfig.js';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Hapoalim];

/** Declarative login configuration for Bank Hapoalim. */
const HAPOALIM_CONFIG: ILoginConfig = {
  loginUrl: CFG.urls.base,
  fields: [
    { credentialKey: 'userCode', selectors: [] }, // wellKnown → #userCode
    { credentialKey: 'password', selectors: [] }, // wellKnown → #password
  ],
  submit: [
    { kind: 'css', value: '.login-btn' },
    // textContent 'כניסה' fallback is in wellKnownSelectors.__submit__
  ],
  /**
   * Wait for Hapoalim post-login redirect.
   * @param page - The Playwright page instance.
   * @returns True when redirect completes.
   */
  postAction: async (page: Page): Promise<void> => {
    await waitForRedirect(page, {});
  },
  possibleResults: {
    success: [
      'https://login.bankhapoalim.co.il/portalserver/HomePage',
      'https://login.bankhapoalim.co.il/ng-portals-bt/rb/he/homepage',
      'https://login.bankhapoalim.co.il/ng-portals/rb/he/homepage',
    ],
    invalidPassword: [
      'https://login.bankhapoalim.co.il/AUTHENTICATE/LOGON?flow=AUTHENTICATE&state=LOGON&errorcode=1.6&callme=false',
    ],
    changePassword: [
      'https://login.bankhapoalim.co.il/MCP/START?flow=MCP&state=START&expiredDate=null',
      /\/ABOUTTOEXPIRE\/START/i,
    ],
  },
};

export { HAPOALIM_CONFIG };
export default HAPOALIM_CONFIG;
