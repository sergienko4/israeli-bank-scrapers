import { CompanyTypes } from '../definitions';
import { type ScraperOptions } from './interface';
import BeinleumiGroupBaseScraper from './base-beinleumi-group';
import { BANK_REGISTRY } from './bank-registry';

class MassadScraper extends BeinleumiGroupBaseScraper {
  BASE_URL = 'https://online.bankmassad.co.il';

  TRANSACTIONS_URL = `${this.BASE_URL}/wps/myportal/FibiMenu/Online/OnAccountMngment/OnBalanceTrans/PrivateAccountFlow`;

  constructor(options: ScraperOptions) {
    super(options, BANK_REGISTRY[CompanyTypes.massad]!);
  }
}

export default MassadScraper;
