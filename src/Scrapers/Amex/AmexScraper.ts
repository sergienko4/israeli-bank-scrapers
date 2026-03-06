import { CompanyTypes } from '../../Definitions';
import { type ScraperOptions } from '../Base/Interface';
import IsracardAmexBaseScraper from '../BaseIsracardAmex/BaseIsracardAmex';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Amex];

/** Scraper implementation for American Express Israel. */
class AmexScraper extends IsracardAmexBaseScraper {
  /**
   * Creates a new Amex scraper instance with bank-specific API base and company code.
   *
   * @param options - scraper options controlling headless mode, timeouts, etc.
   */
  constructor(options: ScraperOptions) {
    super(options, CFG.api.base, CFG.auth.companyCode);
  }
}

export default AmexScraper;
