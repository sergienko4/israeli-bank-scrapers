import { CompanyTypes } from '../../Definitions';
import { type ScraperOptions } from '../Base/Interface';
import BeinleumiGroupBaseScraper from '../BaseBeinleumiGroup/BaseBeinleumiGroup';
import { beinleumiConfig } from '../BaseBeinleumiGroup/BeinleumiLoginConfig';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';

/** Scraper implementation for Bank Beinleumi (First International Bank of Israel). */
class BeinleumiScraper extends BeinleumiGroupBaseScraper {
  /**
   * Creates a BeinleumiScraper with the bank-specific login URL.
   *
   * @param options - scraper options including companyId and timeouts
   */
  constructor(options: ScraperOptions) {
    const beinleumiLoginUrl = SCRAPER_CONFIGURATION.banks[CompanyTypes.Beinleumi].urls.base;
    const beinleumiLoginConfig = beinleumiConfig(beinleumiLoginUrl);
    super(options, beinleumiLoginConfig);
  }
}

export default BeinleumiScraper;
