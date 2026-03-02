import { CompanyTypes } from '../../Definitions';
import { type ScraperOptions } from '../Base/Interface';
import BeinleumiGroupBaseScraper from '../BaseBeinleumiGroup/BaseBeinleumiGroup';
import { BANK_REGISTRY } from '../Registry/BankRegistry';

class OtsarHahayalScraper extends BeinleumiGroupBaseScraper {
  BASE_URL = 'https://online.bankotsar.co.il';

  TRANSACTIONS_URL = `${this.BASE_URL}/wps/myportal/FibiMenu/Online/OnAccountMngment/OnBalanceTrans/PrivateAccountFlow`;

  constructor(options: ScraperOptions) {
    super(options, BANK_REGISTRY[CompanyTypes.OtsarHahayal]!);
  }
}

export default OtsarHahayalScraper;
