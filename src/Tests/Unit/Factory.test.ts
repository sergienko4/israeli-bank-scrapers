import { jest } from '@jest/globals';

import { CompanyTypes } from '../../Definitions.js';
import type { ScraperOptions } from '../../Scrapers/Base/Interface.js';
import createScraper from '../../Scrapers/Registry/Factory.js';

/**
 * Build a scraper and capture any process warning `createScraper` emitted.
 * @param options - Options bag handed to the factory.
 * @returns The warning texts emitted during construction.
 */
function warningsFromCreate(options: ScraperOptions): string[] {
  const emitted: string[] = [];
  const spy = jest.spyOn(process, 'emitWarning').mockImplementation(warning => {
    const text = String(warning);
    emitted.push(text);
  });
  createScraper(options);
  spy.mockRestore();
  return emitted;
}

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

describe('createScraper — legacy-only options on a Pipeline bank (issue #540)', () => {
  it('warns the caller that includeRawTransaction is ignored on a Pipeline bank', () => {
    const emitted = warningsFromCreate({
      companyId: CompanyTypes.Isracard,
      startDate: new Date(),
      includeRawTransaction: true,
    });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toContain('includeRawTransaction');
  });

  it('stays silent for a Pipeline bank when no legacy-only option was passed', () => {
    const emitted = warningsFromCreate({
      companyId: CompanyTypes.Isracard,
      startDate: new Date(),
    });
    expect(emitted).toEqual([]);
  });

  it('stays silent for a legacy bank, which does read the option', () => {
    const emitted = warningsFromCreate({
      companyId: CompanyTypes.Mizrahi,
      startDate: new Date(),
      includeRawTransaction: true,
    });
    expect(emitted).toEqual([]);
  });
});
