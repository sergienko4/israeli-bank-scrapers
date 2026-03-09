import { type Page } from 'playwright';

import { CompanyTypes } from '../../Definitions.js';
import { type ILoginConfig } from '../Base/LoginConfig.js';
import { HISTBASED_FIELDS } from '../Behatsdaa/BehatsdaaLoginConfig.js';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig.js';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.BeyahadBishvilha];

/** Declarative login configuration for BeyahadBishvilha. */
const BEYAHAD_CONFIG: ILoginConfig = {
  loginUrl: CFG.urls.base,
  fields: HISTBASED_FIELDS,
  submit: [
    { kind: 'xpath', value: '//button[contains(., "התחבר")]' },
    // ariaLabel 'התחבר' fallback is now in wellKnownSelectors.__submit__
  ],
  /**
   * Navigate to the BeyahadBishvilha login page.
   * @param page - The Playwright page instance.
   * @returns True when the login page is ready.
   */
  checkReadiness: async (page: Page): Promise<void> => {
    await page.goto(`${CFG.urls.base}/login`);
  },
  possibleResults: { success: [`${CFG.urls.base}/`] },
};

export { BEYAHAD_CONFIG };
export default BEYAHAD_CONFIG;
