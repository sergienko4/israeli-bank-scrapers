/* eslint-disable @typescript-eslint/unbound-method */
import { CompanyTypes } from '../Definitions';
import createScraper from './Factory';

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
