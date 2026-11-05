/**
 * BrowserOnlyOptions — the guard for browser options sent to a bank whose
 * selected transport runs no browser.
 *
 * <p>A headless bank on the `native` or `node-tls` transport never launches a
 * browser or opens a page, so options that configure one have no reader on its
 * run. These tests pin that the guard names those options once, never their
 * values, and stays silent wherever a browser does run. The transport canary at
 * the end builds every registered pipeline and checks the warning agrees with
 * what the descriptor and the transport selector actually wire.
 *
 * Every value is fabricated — no real credentials or paths appear.
 */

import { jest } from '@jest/globals';

import { CompanyTypes } from '../../../../Definitions.js';
import type { ScraperOptions } from '../../../../Scrapers/Base/Interface.js';
import type { IDefaultBrowserOptions } from '../../../../Scrapers/Base/Interfaces/DefaultBrowserOptions.js';
import PIPELINE_REGISTRY from '../../../../Scrapers/Pipeline/Banks/PipelineRegistry.js';
import {
  BROWSER_ONLY_OPTIONS,
  type BrowserOnlyOption,
  findBrowserOnlyOptions,
  warnBrowserOnlyOptions,
} from '../../../../Scrapers/Pipeline/Core/BrowserOnlyOptions.js';
import { resolveHeadlessTransportKind } from '../../../../Scrapers/Pipeline/Core/HeadlessMediatorWiring.js';
import { LEGACY_ONLY_OPTIONS } from '../../../../Scrapers/Pipeline/Core/LegacyOnlyOptions.js';
import type { IPipelineDescriptor } from '../../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';
import { makeMockOptions } from '../Infrastructure/MockFactories.js';

/** Fabricated binary path — must never appear in a warning. */
const FAKE_EXECUTABLE = '/opt/fabricated-browser/bin/firefox';

/** Compile-time pin: every `IDefaultBrowserOptions` key is in the manifest. */
const isDefaultArmCovered: [Exclude<keyof IDefaultBrowserOptions, BrowserOnlyOption>] extends [
  never,
]
  ? true
  : false = true;

/**
 * Build an options bag for one bank, plus any extra fields.
 * @param companyId - Bank the bag targets.
 * @param extra - Additional option keys to merge in.
 * @returns A `ScraperOptions` bag.
 */
function makeOptions(companyId: CompanyTypes, extra: Record<string, unknown> = {}): ScraperOptions {
  const base = makeMockOptions({ companyId });
  return { ...base, ...extra };
}

/** What one `warnBrowserOnlyOptions` call produced. */
interface IWarnOutcome {
  emitted: string[];
  returned: BrowserOnlyOption[];
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
  const returned = warnBrowserOnlyOptions(options);
  spy.mockRestore();
  return { emitted, returned };
}

describe('findBrowserOnlyOptions — detection', () => {
  it('finds nothing in a bag without browser options', () => {
    const clean = makeOptions(CompanyTypes.OneZero);
    const found = findBrowserOnlyOptions(clean);
    expect(found).toEqual([]);
  });

  it.each(BROWSER_ONLY_OPTIONS)('finds %s', option => {
    const single = makeOptions(CompanyTypes.OneZero, { [option]: true });
    const found = findBrowserOnlyOptions(single);
    expect(found).toEqual([option]);
  });

  it('ignores a key explicitly set to undefined', () => {
    const spread = makeOptions(CompanyTypes.OneZero, { shouldShowBrowser: undefined });
    const found = findBrowserOnlyOptions(spread);
    expect(found).toEqual([]);
  });

  it('lists several options in manifest order, not insertion order', () => {
    const bag = { viewportSize: { width: 1, height: 1 }, args: [] };
    const outOfOrder = makeOptions(CompanyTypes.OneZero, bag);
    const found = findBrowserOnlyOptions(outOfOrder);
    expect(found).toEqual(['args', 'viewportSize']);
  });

  it('covers every IDefaultBrowserOptions key', () => {
    expect(isDefaultArmCovered).toBe(true);
  });

  it('shares no name with the legacy-only manifest, so no option warns twice', () => {
    const legacy: readonly string[] = LEGACY_ONLY_OPTIONS;
    const shared = BROWSER_ONLY_OPTIONS.filter((name): boolean => legacy.includes(name));
    expect(shared).toEqual([]);
  });
});

describe('warnBrowserOnlyOptions — browserless transports', () => {
  it('warns once on a node-tls bank, naming each option and the bank', () => {
    const bag = { shouldShowBrowser: true, executablePath: FAKE_EXECUTABLE };
    const options = makeOptions(CompanyTypes.OneZero, bag);
    const { emitted, returned } = captureWarnings(options);
    expect(returned).toEqual(['executablePath', 'shouldShowBrowser']);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toContain('executablePath, shouldShowBrowser');
    expect(emitted[0]).toContain(`"${CompanyTypes.OneZero}"`);
  });

  it('never puts an option value in the warning', () => {
    const options = makeOptions(CompanyTypes.OneZero, { executablePath: FAKE_EXECUTABLE });
    const { emitted } = captureWarnings(options);
    expect(emitted[0]).not.toContain(FAKE_EXECUTABLE);
  });

  it('stays silent on a browserless bank given a clean bag', () => {
    const options = makeOptions(CompanyTypes.OneZero);
    const { emitted, returned } = captureWarnings(options);
    expect({ emitted, returned }).toEqual({ emitted: [], returned: [] });
  });

  it.each([CompanyTypes.Pepper, CompanyTypes.PayBox, CompanyTypes.Beinleumi])(
    'stays silent on %s, whose run uses a browser',
    companyId => {
      const options = makeOptions(companyId, { shouldShowBrowser: true });
      const { emitted, returned } = captureWarnings(options);
      expect({ emitted, returned }).toEqual({ emitted: [], returned: [] });
    },
  );
});

/** Transports that run no browser — the test's own statement of E16. */
const BROWSERLESS_KINDS: readonly string[] = ['native', 'node-tls'];

/**
 * Pinned list of registry banks that run without a browser. A bank PR that
 * moves a bank to a browserless transport adds it here.
 */
const EXPECTED_BROWSERLESS: readonly CompanyTypes[] = [
  CompanyTypes.Hapoalim,
  CompanyTypes.Amex,
  CompanyTypes.Isracard,
  CompanyTypes.VisaCal,
  CompanyTypes.Max,
  CompanyTypes.Mizrahi,
  CompanyTypes.Yahav,
  CompanyTypes.OneZero,
];

const REGISTERED = Object.values(CompanyTypes).filter(
  (companyId): boolean => PIPELINE_REGISTRY[companyId] !== undefined,
);

/**
 * Build a registered pipeline with options naming its own bank.
 * @param companyId - Registry key.
 * @returns The descriptor, or false when the bank has no factory or fails to build.
 */
function buildDescriptor(companyId: CompanyTypes): IPipelineDescriptor | false {
  const factory = PIPELINE_REGISTRY[companyId];
  if (factory === undefined) return false;
  const options = makeMockOptions({ companyId });
  const built = factory(options);
  if (!built.success) return false;
  return built.value;
}

/**
 * Decide from the wiring alone whether a bank's run opens no browser: the
 * descriptor is headless, has no INIT (browser launch) phase, and its headless
 * block selects a transport that needs no browser.
 * @param companyId - Registry key.
 * @returns True when nothing on the run could read a browser option.
 */
function runsWithoutBrowser(companyId: CompanyTypes): boolean {
  const descriptor = buildDescriptor(companyId);
  if (descriptor === false || descriptor.isHeadless !== true) return false;
  if (descriptor.phases.some((phase): boolean => phase.name === 'init')) return false;
  const kind = resolveHeadlessTransportKind(companyId);
  return kind !== false && BROWSERLESS_KINDS.includes(kind);
}

/**
 * Report whether the guard warns for a bank given one browser option.
 * @param companyId - Registry key.
 * @returns True when a warning was emitted.
 */
function warnsFor(companyId: CompanyTypes): boolean {
  const options = makeOptions(companyId, { shouldShowBrowser: true });
  const { emitted } = captureWarnings(options);
  return emitted.length > 0;
}

describe('transport canary — warning agrees with wiring', () => {
  it.each(REGISTERED)('%s warns exactly when its run opens no browser', companyId => {
    const isWarned = warnsFor(companyId);
    const isBrowserless = runsWithoutBrowser(companyId);
    expect(isWarned).toBe(isBrowserless);
  });

  it('warns for exactly the pinned browserless banks', () => {
    const warned = REGISTERED.filter(warnsFor);
    expect(warned).toEqual(EXPECTED_BROWSERLESS);
  });
});
