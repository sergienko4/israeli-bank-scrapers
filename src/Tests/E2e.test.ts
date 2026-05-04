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

  test('every legacy SCRAPERS entry has name + loginFields', () => {
    for (const [key, entry] of Object.entries(SCRAPERS)) {
      expect(entry).toBeDefined();
      expect(entry.name).toBeTruthy();
      expect(entry.loginFields.length).toBeGreaterThan(0);
      expect(key.length).toBeGreaterThan(0);
    }
  });
});

// Real-bank smoke against Hapoalim. Wall-clock dominated by three
// home-phase resolveVisible probes (15s ceiling each) that wait for
// Hapoalim's homepage to settle — the page has continuous marketing
// widgets + analytics that delay stability detection. Observed range
// across CI + local: 42s (fast) → 92s (slow) depending on bank-side
// load. 180s gives 2x headroom against the slow extreme so genuine
// regressions still fail fast (a real break exits well before 180s)
// while bank-side latency variance stops flaking the gate.
const INVALID_CREDS_TEST_TIMEOUT_MS = 180_000;

describe('E2E: IScraper error handling', () => {
  test(
    'scraper rejects with invalid credentials',
    async () => {
      const scraper = createScraper({
        companyId: CompanyTypes.Hapoalim,
        startDate: new Date(),
        shouldShowBrowser: false,
      });
      const result = await scraper.scrape({ userCode: 'invalid', password: 'invalid' });
      expect(result.success).toBe(false);
    },
    INVALID_CREDS_TEST_TIMEOUT_MS,
  );
});
