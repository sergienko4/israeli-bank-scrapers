import { CompanyTypes } from '../Definitions';
import { type ScraperOptions } from './Interface';
import BeinleumiGroupBaseScraper from './BaseBeinleumiGroup';
import { BANK_REGISTRY } from './BankRegistry';

class BeinleumiScraper extends BeinleumiGroupBaseScraper {
  BASE_URL = 'https://online.fibi.co.il';

  TRANSACTIONS_URL = `${this.BASE_URL}/wps/myportal/FibiMenu/Online/OnAccountMngment/OnBalanceTrans/PrivateAccountFlow`;

  constructor(options: ScraperOptions) {
    super(options, BANK_REGISTRY[CompanyTypes.Beinleumi]!);
  }
}

export default BeinleumiScraper;
