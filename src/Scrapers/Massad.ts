import { CompanyTypes } from '../Definitions';
import { BANK_REGISTRY } from './BankRegistry';
import BeinleumiGroupBaseScraper from './BaseBeinleumiGroup';
import { type ScraperOptions } from './Interface';

class MassadScraper extends BeinleumiGroupBaseScraper {
  BASE_URL = 'https://online.bankmassad.co.il';

  TRANSACTIONS_URL = `${this.BASE_URL}/wps/myportal/FibiMenu/Online/OnAccountMngment/OnBalanceTrans/PrivateAccountFlow`;

  constructor(options: ScraperOptions) {
    super(options, BANK_REGISTRY[CompanyTypes.Massad]!);
  }
}

export default MassadScraper;
