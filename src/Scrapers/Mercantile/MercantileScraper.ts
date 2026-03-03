import { CompanyTypes } from '../../Definitions';
import { type ScraperOptions } from '../Base/Interface';
import DiscountScraper from '../Discount/DiscountScraper';
import { BANK_REGISTRY } from '../Registry/BankRegistry';

class MercantileScraper extends DiscountScraper {
  constructor(options: ScraperOptions) {
    super(options, BANK_REGISTRY[CompanyTypes.Mercantile]);
  }
}

export default MercantileScraper;
