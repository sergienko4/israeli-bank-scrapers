import { CompanyTypes } from '../../Definitions.js';
import type { ScraperOptions } from '../../Scrapers/Base/Interface.js';
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

describe('createScraper — unregistered company', () => {
  it('throws for a company id that was removed from the registry', () => {
    const options = { companyId: 'behatsdaa', startDate: new Date() } as unknown as ScraperOptions;
    expect(() => createScraper(options)).toThrow('unknown company id behatsdaa');
  });
});
