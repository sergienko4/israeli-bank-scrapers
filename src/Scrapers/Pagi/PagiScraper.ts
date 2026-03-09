import { CompanyTypes } from '../../Definitions.js';
import { type ScraperOptions } from '../Base/Interface.js';
import BeinleumiGroupBaseScraper from '../BaseBeinleumiGroup/BaseBeinleumiGroup.js';
import { beinleumiConfig } from '../BaseBeinleumiGroup/BeinleumiLoginConfig.js';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig.js';

/** Scraper for Bank Pagi — uses Beinleumi group login flow. */
class PagiScraper extends BeinleumiGroupBaseScraper {
  /**
   * Build a Pagi scraper with Beinleumi group login config.
   * @param options - Scraper configuration options.
   */
  constructor(options: ScraperOptions) {
    const loginConfig = beinleumiConfig(SCRAPER_CONFIGURATION.banks[CompanyTypes.Pagi].urls.base);
    super(options, loginConfig);
  }
}

export default PagiScraper;
