import { CompanyTypes } from '../../Definitions';
import createScraper, { createConcreteScraper } from '../../Scrapers/Registry/Factory';

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

  const allBanks: CompanyTypes[] = [
    CompanyTypes.Hapoalim,
    CompanyTypes.Leumi,
    CompanyTypes.Mizrahi,
    CompanyTypes.Discount,
    CompanyTypes.Mercantile,
    CompanyTypes.OtsarHahayal,
    CompanyTypes.Max,
    CompanyTypes.VisaCal,
    CompanyTypes.Isracard,
    CompanyTypes.Amex,
    CompanyTypes.Beinleumi,
    CompanyTypes.Massad,
    CompanyTypes.Yahav,
    CompanyTypes.Behatsdaa,
    CompanyTypes.BeyahadBishvilha,
    CompanyTypes.OneZero,
    CompanyTypes.Pagi,
  ];

  allBanks.forEach((companyId: CompanyTypes) => {
    test(`createConcreteScraper creates scraper for ${companyId}`, () => {
      const scraper = createConcreteScraper({ companyId, startDate: new Date() });
      expect(typeof scraper.scrape).toBe('function');
    });
  });

  test('createConcreteScraper throws on unknown company id', () => {
    expect(() =>
      createConcreteScraper({
        companyId: 'UNKNOWN' as CompanyTypes,
        startDate: new Date(),
      }),
    ).toThrow('unknown company id');
  });
});
