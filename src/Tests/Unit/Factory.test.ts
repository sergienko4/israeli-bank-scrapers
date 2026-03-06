import { CompanyTypes } from '../../Definitions';
import createScraper from '../../Scrapers/Registry/Factory';

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

  test('throws on unknown company id', () => {
    expect(() =>
      createScraper({
        companyId: 'UNKNOWN_BANK' as unknown as CompanyTypes,
        startDate: new Date(),
      }),
    ).toThrow('unknown company id');
  });
});
