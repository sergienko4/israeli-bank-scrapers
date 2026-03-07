import { CompanyTypes, createScraper, SCRAPERS } from '../Index';

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
  test('scraper throws on invalid executable path', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Hapoalim,
      startDate: new Date(),
      executablePath: '/nonexistent/chrome',
      shouldShowBrowser: false,
    });

    const scrapePromise = scraper.scrape({ userCode: 'test', password: 'test' });
    await expect(scrapePromise).rejects.toThrow();
  }, 30000);
});
