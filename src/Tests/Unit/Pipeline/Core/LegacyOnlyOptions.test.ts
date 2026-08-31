/**
 * LegacyOnlyOptions — the Pipeline guard for deprecated non-Pipeline options.
 *
 * <p>Eight fields declared in the shared public `ScraperOptions` type are read
 * only by the deprecated non-Pipeline scrapers. Passing one alongside a
 * Pipeline bank has no effect at all, which issue #540 reported as a silent
 * drop. These tests pin the guard that makes that drop audible.
 *
 * <p>The warning travels on `process.emitWarning` rather than the pipeline
 * logger because the logger is deliberately silent off-trace in CI and
 * production (`RootLogger.buildTransport` returns `false`, which selects
 * `buildSilentOptions`). A diagnostic the affected caller cannot see would
 * reproduce the very defect it exists to report.
 *
 * Every value is fabricated — no real credentials appear.
 */

import { jest } from '@jest/globals';

import { CompanyTypes } from '../../../../Definitions.js';
import type { ScraperOptions } from '../../../../Scrapers/Base/Interface.js';
import {
  findLegacyOnlyOptions,
  LEGACY_ONLY_OPTIONS,
  type LegacyOnlyOption,
  warnLegacyOnlyOptions,
} from '../../../../Scrapers/Pipeline/Core/LegacyOnlyOptions.js';

/**
 * Build a minimal options bag for a Pipeline bank, plus any extra fields.
 * @param extra - Additional option keys to merge in.
 * @returns A `ScraperOptions` bag targeting a Pipeline bank.
 */
function makeOptions(extra: Record<string, unknown> = {}): ScraperOptions {
  const base = { companyId: CompanyTypes.Isracard, startDate: new Date('2026-01-01') };
  return { ...base, ...extra };
}

describe('findLegacyOnlyOptions — detection', () => {
  it('finds nothing when the caller passes only Pipeline-supported options', () => {
    const supported = makeOptions({ defaultTimeout: 30000 });
    const found = findLegacyOnlyOptions(supported);
    expect(found).toEqual([]);
  });

  it('finds includeRawTransaction, the option reported in issue #540', () => {
    const reported = makeOptions({ includeRawTransaction: true });
    const found = findLegacyOnlyOptions(reported);
    expect(found).toEqual(['includeRawTransaction']);
  });

  it.each(LEGACY_ONLY_OPTIONS)('finds %s, which only the legacy path reads', option => {
    const single = makeOptions({ [option]: true });
    const found = findLegacyOnlyOptions(single);
    expect(found).toEqual([option]);
  });

  it('ignores a key explicitly set to undefined, as spreading optional config produces', () => {
    const explicitlyUndefined = makeOptions({ includeRawTransaction: undefined });
    const found = findLegacyOnlyOptions(explicitlyUndefined);
    expect(found).toEqual([]);
  });

  it('reports false, which is a deliberate opt-out the caller still expects to work', () => {
    const optedOut = makeOptions({ shouldCombineInstallments: false });
    const found = findLegacyOnlyOptions(optedOut);
    expect(found).toEqual(['shouldCombineInstallments']);
  });

  it('lists several ignored options in manifest order, not insertion order', () => {
    const bag = { storeFailureScreenShotPath: '/tmp/x.png', includeRawTransaction: true };
    const outOfOrder = makeOptions(bag);
    const found = findLegacyOnlyOptions(outOfOrder);
    expect(found).toEqual(['includeRawTransaction', 'storeFailureScreenShotPath']);
  });
});

/** What one `warnLegacyOnlyOptions` call produced. */
interface IWarnOutcome {
  emitted: string[];
  returned: LegacyOnlyOption[];
}

/**
 * Run the guard with `process.emitWarning` captured rather than printed.
 * @param options - Options bag to pass to the guard.
 * @returns The warnings emitted and the option names returned.
 */
function captureWarnings(options: ScraperOptions): IWarnOutcome {
  const emitted: string[] = [];
  const spy = jest.spyOn(process, 'emitWarning').mockImplementation(warning => {
    const text = String(warning);
    emitted.push(text);
  });
  const returned = warnLegacyOnlyOptions(options);
  spy.mockRestore();
  return { emitted, returned };
}

describe('warnLegacyOnlyOptions — caller-visible warning', () => {
  it('stays silent when every option passed is supported on the Pipeline', () => {
    const supported = makeOptions({ defaultTimeout: 30000 });
    const { emitted } = captureWarnings(supported);
    expect(emitted).toEqual([]);
  });

  it('emits exactly one warning however many ignored options were passed', () => {
    const bag = { includeRawTransaction: true, optInFeatures: [] };
    const several = makeOptions(bag);
    const { emitted } = captureWarnings(several);
    expect(emitted).toHaveLength(1);
  });

  it('names every ignored option so the caller knows what to remove', () => {
    const bag = { includeRawTransaction: true, navigationRetryCount: 3 };
    const two = makeOptions(bag);
    const { emitted } = captureWarnings(two);
    expect(emitted[0]).toContain('includeRawTransaction');
    expect(emitted[0]).toContain('navigationRetryCount');
  });

  it('names the bank so the caller can tell which scrape dropped the option', () => {
    const reported = makeOptions({ includeRawTransaction: true });
    const { emitted } = captureWarnings(reported);
    expect(emitted[0]).toContain(CompanyTypes.Isracard);
  });

  it('states that the option is ignored and that the legacy path is deprecated', () => {
    const reported = makeOptions({ includeRawTransaction: true });
    const { emitted } = captureWarnings(reported);
    expect(emitted[0]).toContain('ignored');
    expect(emitted[0]).toContain('Legacy (deprecated)');
  });

  it('returns the ignored options so a caller can assert on them programmatically', () => {
    const reported = makeOptions({ includeRawTransaction: true });
    const { returned } = captureWarnings(reported);
    expect(returned).toEqual(['includeRawTransaction']);
  });

  it('never echoes an option value, which may carry a filesystem path or PII', () => {
    const withPath = makeOptions({ storeFailureScreenShotPath: '/home/dana/secret.png' });
    const { emitted } = captureWarnings(withPath);
    expect(emitted[0]).not.toContain('/home/dana/secret.png');
  });
});
