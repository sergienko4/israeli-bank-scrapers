import { CompanyTypes } from '../definitions';
import { type ScraperOptions } from './interface';
import { BANK_REGISTRY } from './bank-registry';
import DiscountScraper from './discount';

class MercantileScraper extends DiscountScraper {
  constructor(options: ScraperOptions) {
    super(options, BANK_REGISTRY[CompanyTypes.mercantile]);
  }
}

export default MercantileScraper;
