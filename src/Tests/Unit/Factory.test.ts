import { CompanyTypes } from '../../Definitions.js';
import createScraper from '../../Scrapers/Registry/Factory.js';

describe('Factory', () => {
  test('should return a scraper instance', () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Hapoalim,
      startDate: new Date(),
    });
    expect(scraper).toBeDefined();

    expect(typeof scraper.scrape).toBe('function');
    expect(typeof scraper.onProgress).toBe('function');
  });
});
