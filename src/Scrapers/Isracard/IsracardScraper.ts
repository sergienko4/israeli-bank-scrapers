import { type ScraperOptions } from '../Base/Interface';
import IsracardAmexBaseScraper from '../BaseIsracardAmex/BaseIsracardAmex';

const BASE_URL = 'https://digital.isracard.co.il';
const COMPANY_CODE = '11';

class IsracardScraper extends IsracardAmexBaseScraper {
  constructor(options: ScraperOptions) {
    super(options, BASE_URL, COMPANY_CODE);
  }
}

export default IsracardScraper;
