import { CompanyTypes } from '../Definitions';
import { type ScraperOptions } from './Interface';
import { BANK_REGISTRY } from './BankRegistry';
import DiscountScraper from './Discount';

class MercantileScraper extends DiscountScraper {
  constructor(options: ScraperOptions) {
    super(options, BANK_REGISTRY[CompanyTypes.Mercantile]);
  }
}

export default MercantileScraper;
