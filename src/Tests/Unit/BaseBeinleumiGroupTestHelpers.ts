import { type ScraperOptions } from '../../Scrapers/Base/Interface';
import BeinleumiGroupBaseScraper from '../../Scrapers/BaseBeinleumiGroup/BaseBeinleumiGroup';
import { beinleumiConfig } from '../../Scrapers/BaseBeinleumiGroup/BeinleumiLoginConfig';

/** Concrete Beinleumi group scraper used in unit tests with a test login URL. */
export default class TestBeinleumiScraper extends BeinleumiGroupBaseScraper {
  public BASE_URL = 'https://test.fibi.co.il';

  public TRANSACTIONS_URL = 'https://test.fibi.co.il/transactions';

  /**
   * Creates a TestBeinleumiScraper with a test login URL.
   *
   * @param options - scraper options for the test
   */
  constructor(options: ScraperOptions) {
    const loginConfig = beinleumiConfig('https://www.fibi.co.il');
    super(options, loginConfig);
  }
}
