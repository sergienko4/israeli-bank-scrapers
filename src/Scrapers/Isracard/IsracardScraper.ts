import { CompanyTypes } from '../../Definitions.js';
import { type ScraperOptions } from '../Base/Interface.js';
import IsracardAmexBaseScraper from '../BaseIsracardAmex/BaseIsracardAmex.js';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig.js';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Isracard];

/** Scraper for Isracard — uses the shared Isracard/Amex base. */
class IsracardScraper extends IsracardAmexBaseScraper {
  /**
   * Build an Isracard scraper with centralized API config.
   * @param options - Scraper configuration options.
   */
  constructor(options: ScraperOptions) {
    super(options, CFG.api.base, CFG.auth.companyCode);
  }
}

export default IsracardScraper;
