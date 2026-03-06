import { CompanyTypes } from '../../Definitions';
import { type ScraperOptions } from '../Base/Interface';
import BeinleumiGroupBaseScraper from '../BaseBeinleumiGroup/BaseBeinleumiGroup';
import { beinleumiConfig } from '../BaseBeinleumiGroup/BeinleumiLoginConfig';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';

/** Scraper implementation for Pagi (Beinleumi group). */
class PagiScraper extends BeinleumiGroupBaseScraper {
  /**
   * Creates a PagiScraper with the bank-specific login URL.
   *
   * @param options - scraper options including companyId and timeouts
   */
  constructor(options: ScraperOptions) {
    const pagiLoginUrl = SCRAPER_CONFIGURATION.banks[CompanyTypes.Pagi].urls.base;
    const pagiConfig = beinleumiConfig(pagiLoginUrl);
    super(options, pagiConfig);
  }
}

export default PagiScraper;
