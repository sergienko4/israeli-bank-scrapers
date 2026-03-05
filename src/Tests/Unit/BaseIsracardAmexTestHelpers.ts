import type { ScraperOptions } from '../../Scrapers/Base/Interface';
import IsracardAmexBaseScraper from '../../Scrapers/BaseIsracardAmex/BaseIsracardAmex';
import { createMockScraperOptions } from '../MockPage';

const BASE_URL = 'https://americanexpress.co.il';

export default class TestAmexScraper extends IsracardAmexBaseScraper {
  constructor(overrides: Partial<ScraperOptions> = {}) {
    super(createMockScraperOptions(overrides), BASE_URL, '77');
  }
}
