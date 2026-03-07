import { CompanyTypes } from '../../Definitions';
import { type ScraperOptions } from '../Base/Interface';
import IsracardAmexBaseScraper from '../BaseIsracardAmex/BaseIsracardAmex';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Isracard];

/** IScraper implementation for Isracard credit card. */
class IsracardScraper extends IsracardAmexBaseScraper {
  /**
   * Creates an IsracardScraper with the bank-specific API base and company code.
   *
   * @param options - scraper options controlling headless mode, timeouts, etc.
   */
  constructor(options: ScraperOptions) {
    super(options, CFG.api.base, CFG.auth.companyCode);
  }
}

export default IsracardScraper;
