import { type ScraperOptions } from '../Base/Interface';
import IsracardAmexBaseScraper from '../BaseIsracardAmex/BaseIsracardAmex';

const BASE_URL = 'https://he.americanexpress.co.il';
const COMPANY_CODE = '77';

class AmexScraper extends IsracardAmexBaseScraper {
  constructor(options: ScraperOptions) {
    super(options, BASE_URL, COMPANY_CODE);
  }
}

export default AmexScraper;
