import { CompanyTypes } from '../../Definitions';
import { type ScraperOptions } from '../Base/Interface';
import BeinleumiGroupBaseScraper from '../BaseBeinleumiGroup/BaseBeinleumiGroup';
import { beinleumiConfig } from '../BaseBeinleumiGroup/BeinleumiLoginConfig';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';

/** IScraper implementation for Bank Massad (Beinleumi group). */
class MassadScraper extends BeinleumiGroupBaseScraper {
  /**
   * Creates a MassadScraper with the bank-specific login URL.
   *
   * @param options - scraper options including companyId and timeouts
   */
  constructor(options: ScraperOptions) {
    const massadLoginUrl = SCRAPER_CONFIGURATION.banks[CompanyTypes.Massad].urls.base;
    const massadConfig = beinleumiConfig(massadLoginUrl);
    super(options, massadConfig);
  }
}

export default MassadScraper;
