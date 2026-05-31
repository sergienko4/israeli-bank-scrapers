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

// Real-bank smoke against Hapoalim. Wall-clock dominated by:
//  (a) home-phase resolveVisible probes (15s ceiling each, retries up to 2x)
//      waiting for Hapoalim's homepage to settle — marketing widgets +
//      analytics delay stability detection;
//  (b) the central PHASE_SETTLE_MS pause fired at every phase.PRE AND
//      every phase.FINAL (commit a46c0635, 2026-05-17). The invalid-
//      creds run traverses INIT → HOME → LOGIN → OTP-TRIGGER → OTP-FILL
//      before the bank rejects with "OTP input missing", which means
//      ~5 phases × 8 s settles = ~40 s of pure settle time.
// Observed range before split-settle: 42 s (fast) → 92 s (slow). With
// settles: ~80 s (fast) → ~140 s (slow). 300 s gives 2x headroom against
// the slow extreme so genuine regressions still fail fast (a real break
// exits well before 300 s) while bank-side latency variance + settle
// budgets stop flaking the gate.
const INVALID_CREDS_TEST_TIMEOUT_MS = 300_000;

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
