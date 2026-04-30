import type { ScraperOptions } from '../../../../Scrapers/Base/Interface.js';
import {
  DEFAULT_FUTURE_MONTHS,
  getFutureMonths,
} from '../../../../Scrapers/Pipeline/Types/ScraperDefaults.js';

const BASE: ScraperOptions = {
  companyId: 'mercantile' as unknown as ScraperOptions['companyId'],
  startDate: new Date('2026-01-01'),
};

describe('ScraperDefaults/DEFAULT_FUTURE_MONTHS', () => {
  it('is 1 (current + next billing cycle)', () => {
    expect(DEFAULT_FUTURE_MONTHS).toBe(1);
  });
});

describe('ScraperDefaults/getFutureMonths', () => {
  it('returns DEFAULT_FUTURE_MONTHS when futureMonthsToScrape is undefined', () => {
    const resolved = getFutureMonths(BASE);
    expect(resolved).toBe(DEFAULT_FUTURE_MONTHS);
  });

  it('respects explicit zero (zero-intent)', () => {
    const opts: ScraperOptions = { ...BASE, futureMonthsToScrape: 0 };
    const resolved = getFutureMonths(opts);
    expect(resolved).toBe(0);
  });

  it('returns the explicit value when caller passes a positive number', () => {
    const opts: ScraperOptions = { ...BASE, futureMonthsToScrape: 3 };
    const resolved = getFutureMonths(opts);
    expect(resolved).toBe(3);
  });

  it('falls back to default when futureMonthsToScrape is null', () => {
    const opts = { ...BASE, futureMonthsToScrape: null } as unknown as ScraperOptions;
    const resolved = getFutureMonths(opts);
    expect(resolved).toBe(DEFAULT_FUTURE_MONTHS);
  });
});
