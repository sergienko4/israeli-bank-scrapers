import { CompanyTypes } from '../Definitions';
import { BANK_REGISTRY } from './BankRegistry';
import DiscountScraper from './Discount';
import { type ScraperOptions } from './Interface';

class MercantileScraper extends DiscountScraper {
  constructor(options: ScraperOptions) {
    super(options, BANK_REGISTRY[CompanyTypes.Mercantile]);
  }
}

export default MercantileScraper;
