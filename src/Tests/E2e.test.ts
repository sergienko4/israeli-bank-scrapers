import { CompanyTypes, createScraper, SCRAPERS } from '../index.js';

describe('E2E: IScraper Factory', () => {
  const allCompanyTypes = Object.values(CompanyTypes);

  test.each(allCompanyTypes)('createScraper(%s) returns a valid scraper instance', companyId => {
    const scraper = createScraper({
      companyId,
      startDate: new Date(),
    });
    expect(scraper).toBeDefined();
    expect(typeof scraper.scrape).toBe('function');
    expect(typeof scraper.onProgress).toBe('function');
  });

  test('every CompanyType has a SCRAPERS definition', () => {
    for (const companyId of allCompanyTypes) {
      expect(SCRAPERS[companyId]).toBeDefined();
      expect(SCRAPERS[companyId].name).toBeTruthy();
      expect(SCRAPERS[companyId].loginFields.length).toBeGreaterThan(0);
    }
  });
});

describe('E2E: IScraper error handling', () => {
  test('scraper rejects with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Hapoalim,
      startDate: new Date(),
      shouldShowBrowser: false,
    });
    const result = await scraper.scrape({ userCode: 'invalid', password: 'invalid' });
    expect(result.success).toBe(false);
  }, 60000);
});
