/* eslint-disable @typescript-eslint/unbound-method */
import { CompanyTypes } from '../../Definitions';
import createScraper from '../../Scrapers/Registry/Factory';

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

  test('throws on unknown company id', () => {
    expect(() =>
      createScraper({
        companyId: 'UNKNOWN_BANK' as unknown as CompanyTypes,
        startDate: new Date(),
      }),
    ).toThrow('unknown company id');
  });
});
