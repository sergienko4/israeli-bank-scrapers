/* eslint-disable @typescript-eslint/unbound-method */
import { CompanyTypes } from '../../Definitions.js';
import createScraper from '../../Scrapers/Registry/Factory.js';

describe('Factory', () => {
  test('should return a scraper instance', () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Hapoalim,
      startDate: new Date(),
    });
    expect(scraper).toBeDefined();

    expect(scraper.scrape).toBeInstanceOf(Function);
    expect(scraper.onProgress).toBeInstanceOf(Function);
  });
});
