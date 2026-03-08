import { CompanyTypes } from '../../Definitions.js';
import { type ScraperOptions } from '../Base/Interface.js';
import { discountConfig } from '../Discount/DiscountLoginConfig.js';
import DiscountScraper from '../Discount/DiscountScraper.js';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig.js';

class MercantileScraper extends DiscountScraper {
  constructor(options: ScraperOptions) {
    super(options, discountConfig(SCRAPER_CONFIGURATION.banks[CompanyTypes.Mercantile].urls.base));
  }
}

export default MercantileScraper;
