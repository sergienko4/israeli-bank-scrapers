import { type Page } from 'playwright';

import { elementPresentOnPage } from '../../Common/ElementsInteractions';
import { CompanyTypes } from '../../Definitions';
import type { IDoneResult } from '../../Interfaces/Common/StepResult';
import { type ILoginConfig } from '../Base/LoginConfig';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';

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
   * Navigates to the Behatsdaa login route before filling credentials.
   *
   * @param page - the Playwright page to navigate
   * @returns a done result after navigating to the login page
   */
  checkReadiness: async (page: Page): Promise<IDoneResult> => {
    await page.goto(`${CFG.urls.base}/login`);
    return { done: true };
  },
  possibleResults: {
    success: [`${CFG.urls.base}/`],
    invalidPassword: [
      async (opts): Promise<boolean> =>
        !!(opts?.page && (await elementPresentOnPage(opts.page, '.custom-input-error-label'))),
    ],
  },
};
