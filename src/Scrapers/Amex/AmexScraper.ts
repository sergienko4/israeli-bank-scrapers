import { CompanyTypes } from '../../Definitions';
import { type ScraperOptions } from '../Base/Interface';
import IsracardAmexBaseScraper from '../BaseIsracardAmex/BaseIsracardAmex';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Amex];

class AmexScraper extends IsracardAmexBaseScraper {
  constructor(options: ScraperOptions) {
    super(options, CFG.api.base, CFG.auth.companyCode);
  }
}

export default AmexScraper;
