import { CompanyTypes } from '../../Definitions.js';
import { type ScraperOptions } from '../Base/Interface.js';
import BeinleumiGroupBaseScraper from '../BaseBeinleumiGroup/BaseBeinleumiGroup.js';
import { beinleumiConfig } from '../BaseBeinleumiGroup/Config/BeinleumiLoginConfig.js';
import { SCRAPER_CONFIGURATION } from '../Registry/Config/ScraperConfig.js';

/** Scraper for Otsar Hahayal — uses Beinleumi group login flow. */
class OtsarHahayalScraper extends BeinleumiGroupBaseScraper {
  /**
   * Build an OtsarHahayal scraper with Beinleumi group login config.
   * @param options - Scraper configuration options.
   */
  constructor(options: ScraperOptions) {
    const otsarUrl = SCRAPER_CONFIGURATION.banks[CompanyTypes.OtsarHahayal].urls.base;
    const loginConfig = beinleumiConfig(otsarUrl);
    super(options, loginConfig);
  }
}

export default OtsarHahayalScraper;
