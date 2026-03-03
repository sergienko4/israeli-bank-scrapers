import { CompanyTypes } from '../../Definitions';
import { type ScraperOptions } from '../Base/Interface';
import BeinleumiGroupBaseScraper from '../BaseBeinleumiGroup/BaseBeinleumiGroup';
import { BANK_REGISTRY } from '../Registry/BankRegistry';

class MassadScraper extends BeinleumiGroupBaseScraper {
  constructor(options: ScraperOptions) {
    super(options, BANK_REGISTRY[CompanyTypes.Massad]!);
  }
}

export default MassadScraper;
