import { type ScraperOptions } from '../../Scrapers/Base/Interface';
import BeinleumiGroupBaseScraper from '../../Scrapers/BaseBeinleumiGroup/BaseBeinleumiGroup';
import { beinleumiConfig } from '../../Scrapers/BaseBeinleumiGroup/BeinleumiLoginConfig';

export default class TestBeinleumiScraper extends BeinleumiGroupBaseScraper {
  public BASE_URL = 'https://test.fibi.co.il';

  public TRANSACTIONS_URL = 'https://test.fibi.co.il/transactions';

  constructor(options: ScraperOptions) {
    super(options, beinleumiConfig('https://www.fibi.co.il'));
  }
}
