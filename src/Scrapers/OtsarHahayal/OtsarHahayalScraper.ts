import { CompanyTypes } from '../../Definitions.js';
import { type ScraperOptions } from '../Base/Interface.js';
import BeinleumiGroupBaseScraper from '../BaseBeinleumiGroup/BaseBeinleumiGroup.js';
import { beinleumiConfig } from '../BaseBeinleumiGroup/BeinleumiLoginConfig.js';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig.js';

class OtsarHahayalScraper extends BeinleumiGroupBaseScraper {
  constructor(options: ScraperOptions) {
    super(
      options,
      beinleumiConfig(SCRAPER_CONFIGURATION.banks[CompanyTypes.OtsarHahayal].urls.base),
    );
  }
}

export default OtsarHahayalScraper;
