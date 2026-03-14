import { type Page } from 'playwright';

import { elementPresentOnPage } from '../../../Common/ElementsInteractions.js';
import { CompanyTypes } from '../../../Definitions.js';
import { type ILoginConfig } from '../../Base/Config/LoginConfig.js';
import { SCRAPER_CONFIGURATION } from '../../Registry/Config/ScraperConfig.js';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Behatsdaa];

// Behatsdaa and BeyahadBishvilha share the same login form selectors
// (selectors: [] — wellKnown finds #loginId and #loginPassword)
export const HISTBASED_FIELDS: ILoginConfig['fields'] = [
  { credentialKey: 'id', selectors: [] }, // wellKnown → #loginId
  { credentialKey: 'password', selectors: [] }, // wellKnown → #loginPassword
];

export const BEHATSDAA_CONFIG: ILoginConfig = {
  loginUrl: CFG.urls.base,
  fields: HISTBASED_FIELDS,
  submit: [
    { kind: 'xpath', value: '//button[contains(., "התחברות")]' },
    // ariaLabel 'התחברות' fallback is now in wellKnownSelectors.__submit__
  ],
  /**
   * Navigate to the Behatsdaa login page.
   * @param page - The Playwright page instance.
   * @returns True when the login page is ready.
   */
  checkReadiness: async (page: Page): Promise<void> => {
    await page.goto(`${CFG.urls.base}/login`);
  },
  possibleResults: {
    success: [`${CFG.urls.base}/`],
    invalidPassword: [
      async (opts): Promise<boolean> =>
        !!(opts?.page && (await elementPresentOnPage(opts.page, 'role=alert'))),
    ],
  },
};
