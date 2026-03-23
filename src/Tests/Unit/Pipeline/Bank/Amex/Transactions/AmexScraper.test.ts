/**
 * Unit tests for Amex pipeline scraper — monthly fetch config shape.
 * Tests AMEX_MONTHLY config for MonthlyScrapeFactory compatibility.
 */

import { AMEX_MONTHLY } from '../../../../../../Scrapers/Pipeline/Banks/Amex/AmexScraper.js';

describe('AMEX_MONTHLY', () => {
  it('has defaultMonthsBack of 6', () => {
    expect(AMEX_MONTHLY.defaultMonthsBack).toBe(6);
  });

  it('has rateLimitMs of 1000', () => {
    expect(AMEX_MONTHLY.rateLimitMs).toBe(1000);
  });

  it('has fetchMonth function', () => {
    expect(typeof AMEX_MONTHLY.fetchMonth).toBe('function');
  });
});
