import { CompanyTypes } from '../../Definitions';
import { type ScraperOptions } from '../Base/Interface';
import BeinleumiGroupBaseScraper from '../BaseBeinleumiGroup/BaseBeinleumiGroup';
import { BANK_REGISTRY } from '../Registry/BankRegistry';

class BeinleumiScraper extends BeinleumiGroupBaseScraper {
  constructor(options: ScraperOptions) {
    super(options, BANK_REGISTRY[CompanyTypes.Beinleumi]!);
  }
}

export default BeinleumiScraper;
