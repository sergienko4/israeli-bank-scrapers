import { jest } from '@jest/globals';

import { CompanyTypes } from '../../Definitions.js';
import type { ScraperOptions } from '../../Scrapers/Base/Interface.js';
import createScraper from '../../Scrapers/Registry/Factory.js';
import withLegacyOnlyOptions from '../Helpers/LegacyOnlyOptionsBag.js';

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
    const base: ScraperOptions = { companyId: CompanyTypes.Isracard, startDate: new Date() };
    const options = withLegacyOnlyOptions(base, { includeRawTransaction: true });
    const emitted = warningsFromCreate(options);
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
});

describe('createScraper — unregistered company', () => {
  it('throws for a company id that was removed from the registry', () => {
    const options = { companyId: 'behatsdaa', startDate: new Date() } as unknown as ScraperOptions;
    expect(() => createScraper(options)).toThrow('unknown company id behatsdaa');
  });
});

describe('createScraper — browser options on a browserless bank', () => {
  it('warns that shouldShowBrowser is ignored on a node-tls bank', () => {
    const options: ScraperOptions = {
      companyId: CompanyTypes.OneZero,
      startDate: new Date(),
      shouldShowBrowser: true,
    };
    const emitted = warningsFromCreate(options);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toContain('shouldShowBrowser');
  });

  it('stays silent for a browser-backed bank given the same option', () => {
    const emitted = warningsFromCreate({
      companyId: CompanyTypes.Leumi,
      startDate: new Date(),
      shouldShowBrowser: true,
    });
    expect(emitted).toEqual([]);
  });

  it('stays silent for a browserless bank given a clean bag', () => {
    const emitted = warningsFromCreate({ companyId: CompanyTypes.OneZero, startDate: new Date() });
    expect(emitted).toEqual([]);
  });

  it('emits one warning for each ignored option group', () => {
    const base: ScraperOptions = {
      companyId: CompanyTypes.OneZero,
      startDate: new Date(),
      shouldShowBrowser: true,
    };
    const options = withLegacyOnlyOptions(base, { skipCloseBrowser: true });
    const emitted = warningsFromCreate(options);
    const text = emitted.join('\n');
    expect(emitted).toHaveLength(2);
    expect(text).toContain('skipCloseBrowser');
    expect(text).toContain('shouldShowBrowser');
  });
});
