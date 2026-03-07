import { CompanyTypes } from '../../Definitions';
import { type ScraperOptions } from '../Base/Interface';
import BeinleumiGroupBaseScraper from '../BaseBeinleumiGroup/BaseBeinleumiGroup';
import { beinleumiConfig } from '../BaseBeinleumiGroup/BeinleumiLoginConfig';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';

/** IScraper implementation for Otsar HaHayal Bank (Beinleumi group). */
class OtsarHahayalScraper extends BeinleumiGroupBaseScraper {
  /**
   * Creates an OtsarHahayalScraper with the bank-specific login URL.
   *
   * @param options - scraper options including companyId and timeouts
   */
  constructor(options: ScraperOptions) {
    const otsarLoginUrl = SCRAPER_CONFIGURATION.banks[CompanyTypes.OtsarHahayal].urls.base;
    const otsarConfig = beinleumiConfig(otsarLoginUrl);
    super(options, otsarConfig);
  }
}

export default OtsarHahayalScraper;
