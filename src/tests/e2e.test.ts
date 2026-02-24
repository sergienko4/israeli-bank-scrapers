/* eslint-disable @typescript-eslint/unbound-method */
import { CompanyTypes, createScraper, SCRAPERS } from '../index';

describe('E2E: Scraper Factory', () => {
  const allCompanyTypes = Object.values(CompanyTypes);

  test.each(allCompanyTypes)('createScraper(%s) returns a valid scraper instance', companyId => {
    const scraper = createScraper({
      companyId,
      startDate: new Date(),
    });
    expect(scraper).toBeDefined();
    expect(scraper.scrape).toBeInstanceOf(Function);
    expect(scraper.onProgress).toBeInstanceOf(Function);
  });

  test('every CompanyType has a SCRAPERS definition', () => {
    for (const companyId of allCompanyTypes) {
      expect(SCRAPERS[companyId]).toBeDefined();
      expect(SCRAPERS[companyId].name).toBeTruthy();
      expect(SCRAPERS[companyId].loginFields.length).toBeGreaterThan(0);
    }
  });
});

describe('E2E: Scraper error handling', () => {
  test('scraper throws on invalid executable path', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.hapoalim,
      startDate: new Date(),
      executablePath: '/nonexistent/chrome',
      showBrowser: false,
    });

    await expect(scraper.scrape({ userCode: 'test', password: 'test' })).rejects.toThrow();
  }, 30000);
});
