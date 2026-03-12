import { CompanyTypes } from '../../Definitions.js';
import { type ScraperOptions } from '../Base/Interface.js';
import discountConfig from '../Discount/Config/DiscountLoginConfig.js';
import DiscountScraper from '../Discount/DiscountScraper.js';
import { SCRAPER_CONFIGURATION } from '../Registry/Config/ScraperConfig.js';

/** Scraper for Mercantile — uses Discount login flow. */
class MercantileScraper extends DiscountScraper {
  /**
   * Build a Mercantile scraper with Discount login config.
   * @param options - Scraper configuration options.
   */
  constructor(options: ScraperOptions) {
    const mercantileUrl = SCRAPER_CONFIGURATION.banks[CompanyTypes.Mercantile].urls.base;
    const loginConfig = discountConfig(mercantileUrl);
    super(options, loginConfig);
  }
}

export default MercantileScraper;
