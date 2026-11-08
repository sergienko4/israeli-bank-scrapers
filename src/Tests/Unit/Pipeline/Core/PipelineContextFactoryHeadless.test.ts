/**
 * Unit tests for PipelineContextFactory.wireHeadlessMediator —
 * covers the headless-mode branches wired off PIPELINE_BANK_CONFIG.
 */

import { CompanyTypes } from '../../../../Definitions.js';
import type { ScraperOptions } from '../../../../Scrapers/Base/Interface.js';
import { buildInitialContext } from '../../../../Scrapers/Pipeline/Core/PipelineContextFactory.js';
import type { IPipelineDescriptor } from '../../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';

/** Synthetic, unregistered bank — exercises the "no config" branch. */
const UNREGISTERED_BANK = 'synthetic-unregistered' as unknown as CompanyTypes;

/**
 * Build a minimal descriptor with the given options + isHeadless flag.
 * @param isHeadless - Headless mode on / off.
 * @param companyId - Company id to plant in options.
 * @returns Minimal descriptor literal.
 */
function makeDescriptor(isHeadless: boolean, companyId: CompanyTypes): IPipelineDescriptor {
  const options = { companyId, startDate: new Date('2024-01-01') } as unknown as ScraperOptions;
  return {
    options,
    phases: [],
    interceptors: [],
    isHeadless,
  };
}

describe('PipelineContextFactory — wireHeadlessMediator', () => {
  /**
   * The apiMediator slot's outcome per branch: an HTML bank with the flag
   * off, a headless bank whose config carries the block, a bank the config
   * never registered, a headless bank whose config has no block, and the
   * non-headless Leumi repeat. Driven from one table per CLAUDE.md's
   * config-array rule (no duplicated test bodies).
   */
  const apiMediatorCases = [
    {
      name: 'HTML bank (isHeadless=false): apiMediator slot stays none',
      isHeadless: false,
      companyId: CompanyTypes.Leumi,
      hasMediator: false,
    },
    {
      name: 'Headless bank with headless block in config: apiMediator populated',
      isHeadless: true,
      companyId: CompanyTypes.OneZero,
      hasMediator: true,
    },
    {
      name: 'Headless flag but bank missing from config: apiMediator stays none',
      isHeadless: true,
      companyId: UNREGISTERED_BANK,
      hasMediator: false,
    },
    {
      name: 'Headless flag but bank has no headless block: apiMediator stays none',
      isHeadless: true,
      companyId: CompanyTypes.Leumi,
      hasMediator: false,
    },
    {
      name: 'OZ-PCF-03 — Leumi (non-headless): apiMediator slot stays none',
      isHeadless: false,
      companyId: CompanyTypes.Leumi,
      hasMediator: false,
    },
  ] as const;

  it.each(apiMediatorCases)('$name', ({ isHeadless, companyId, hasMediator }) => {
    const descriptor = makeDescriptor(isHeadless, companyId);
    const ctx = buildInitialContext(
      descriptor,
      {} as unknown as Parameters<typeof buildInitialContext>[1],
    );
    expect(ctx.apiMediator.has).toBe(hasMediator);
  });

  it('buildInitialContext returns a well-formed context (non-headless default)', () => {
    const descriptor = makeDescriptor(false, CompanyTypes.Leumi);
    const ctx = buildInitialContext(descriptor, { id: 'syn', password: 'syn' });
    expect(ctx.options.companyId).toBe(CompanyTypes.Leumi);
    expect(ctx.browser.has).toBe(false);
    expect(ctx.mediator.has).toBe(false);
    expect(ctx.apiMediator.has).toBe(false);
    expect(ctx.loginAreaReady).toBe(false);
  });

  /**
   * Cross-bank native-transport matrix: Pepper and PayBox run their identity
   * calls over Node's own fetch, so their headless ApiMediator drives no
   * browser and exposes NO `dispose` hook. Driven via a single config array
   * per CLAUDE.md's "config arrays mapped with .map() — no duplication" rule.
   * OneZero (node:https mTLS) follows the same contract — see OZ-PCF-01 below.
   */
  const nativeNoDisposeCases = [
    { testId: 'PP-PCF-02', bankName: 'Pepper', companyId: CompanyTypes.Pepper },
    { testId: 'PB-PCF-04', bankName: 'PayBox', companyId: CompanyTypes.PayBox },
  ] as const;

  nativeNoDisposeCases.forEach(({ testId, bankName, companyId }) => {
    it(`${testId} — ${bankName} (nativeFetch=true): mediator exposes no dispose hook`, () => {
      const descriptor = makeDescriptor(true, companyId);
      const ctx = buildInitialContext(
        descriptor,
        {} as unknown as Parameters<typeof buildInitialContext>[1],
      );
      expect(ctx.apiMediator.has).toBe(true);
      if (ctx.apiMediator.has) {
        expect(ctx.apiMediator.value.dispose).toBeUndefined();
        expect(ctx.apiMediator.value.drivesBrowser).toBeUndefined();
      }
    });
  });

  it('OZ-PCF-01 — OneZero (requiresClientCert=true): mTLS mediator exposes no dispose hook', () => {
    const descriptor = makeDescriptor(true, CompanyTypes.OneZero);
    const ctx = buildInitialContext(
      descriptor,
      {} as unknown as Parameters<typeof buildInitialContext>[1],
    );
    expect(ctx.apiMediator.has).toBe(true);
    if (ctx.apiMediator.has) {
      expect(ctx.apiMediator.value.dispose).toBeUndefined();
    }
  });
});
