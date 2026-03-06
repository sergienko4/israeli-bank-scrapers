import type { ScraperOptions } from '../../Scrapers/Base/Interface';
import IsracardAmexBaseScraper from '../../Scrapers/BaseIsracardAmex/BaseIsracardAmex';
import { createMockScraperOptions } from '../MockPage';

const BASE_URL = 'https://americanexpress.co.il';

/** Concrete AmexScraper used in unit tests with a fixed base URL and company code. */
export default class TestAmexScraper extends IsracardAmexBaseScraper {
  /**
   * Creates a TestAmexScraper with optional scraper option overrides.
   *
   * @param overrides - partial scraper options to override the test defaults
   */
  constructor(overrides: Partial<ScraperOptions> = {}) {
    const opts = createMockScraperOptions(overrides);
    super(opts, BASE_URL, '77');
  }
}
