import IsracardAmexBaseScraper from './BaseIsracardAmex';
import { type ScraperOptions } from './Interface';

const BASE_URL = 'https://digital.isracard.co.il';
const COMPANY_CODE = '11';

class IsracardScraper extends IsracardAmexBaseScraper {
  constructor(options: ScraperOptions) {
    super(options, BASE_URL, COMPANY_CODE);
  }
}

export default IsracardScraper;
