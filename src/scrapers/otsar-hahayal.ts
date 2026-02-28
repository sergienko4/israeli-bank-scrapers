import { CompanyTypes } from '../definitions';
import { type ScraperOptions } from './interface';
import BeinleumiGroupBaseScraper from './base-beinleumi-group';
import { BANK_REGISTRY } from './bank-registry';

class OtsarHahayalScraper extends BeinleumiGroupBaseScraper {
  BASE_URL = 'https://online.bankotsar.co.il';

  TRANSACTIONS_URL = `${this.BASE_URL}/wps/myportal/FibiMenu/Online/OnAccountMngment/OnBalanceTrans/PrivateAccountFlow`;

  constructor(options: ScraperOptions) {
    super(options, BANK_REGISTRY[CompanyTypes.otsarHahayal]!);
  }
}

export default OtsarHahayalScraper;
