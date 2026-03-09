import { CompanyTypes } from '../../Definitions.js';
import { type ScraperOptions } from '../Base/Interface.js';
import BeinleumiGroupBaseScraper from '../BaseBeinleumiGroup/BaseBeinleumiGroup.js';
import { beinleumiConfig } from '../BaseBeinleumiGroup/BeinleumiLoginConfig.js';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig.js';

/** Scraper for Bank Beinleumi — extends the shared Beinleumi group base. */
class BeinleumiScraper extends BeinleumiGroupBaseScraper {
  /**
   * Create a Beinleumi scraper with the bank-specific login configuration.
   * @param options - The scraper configuration options.
   */
  constructor(options: ScraperOptions) {
    const bankConfig = SCRAPER_CONFIGURATION.banks[CompanyTypes.Beinleumi];
    const loginConfig = beinleumiConfig(bankConfig.urls.base);
    super(options, loginConfig);
  }
}

export default BeinleumiScraper;
