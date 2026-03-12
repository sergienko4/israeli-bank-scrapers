import { CompanyTypes } from '../../Definitions.js';
import { type ScraperOptions } from '../Base/Interface.js';
import IsracardAmexBaseScraper from '../BaseIsracardAmex/BaseIsracardAmex.js';
import { SCRAPER_CONFIGURATION } from '../Registry/Config/ScraperConfig.js';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Amex];

/** Scraper for American Express Israel — uses the shared Isracard/Amex base. */
class AmexScraper extends IsracardAmexBaseScraper {
  /**
   * Build an Amex scraper with centralized API config.
   * @param options - Scraper configuration options.
   */
  constructor(options: ScraperOptions) {
    super(options, CFG.api.base, CFG.auth.companyCode);
  }
}

export default AmexScraper;
