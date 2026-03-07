import { CompanyTypes } from '../../Definitions';
import { type ScraperOptions } from '../Base/Interface';
import { discountConfig } from '../Discount/DiscountLoginConfig';
import DiscountScraper from '../Discount/DiscountScraper';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';

/** IScraper implementation for Mercantile Discount Bank (shares Discount Bank infrastructure). */
class MercantileScraper extends DiscountScraper {
  /**
   * Creates a MercantileScraper using the Mercantile bank login URL.
   *
   * @param options - scraper options including companyId and timeouts
   */
  constructor(options: ScraperOptions) {
    const mercantileLoginUrl = SCRAPER_CONFIGURATION.banks[CompanyTypes.Mercantile].urls.base;
    const mercantileConfig = discountConfig(mercantileLoginUrl);
    super(options, mercantileConfig);
  }
}

export default MercantileScraper;
