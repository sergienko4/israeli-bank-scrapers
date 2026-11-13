/**
 * Unit tests for PipelineContextFactory's HTTP-mediator wiring —
 * covers the branches driven off PIPELINE_BANK_CONFIG.
 */

import { CompanyTypes } from '../../../../Definitions.js';
import type { ScraperOptions } from '../../../../Scrapers/Base/Interface.js';
import { buildInitialContext } from '../../../../Scrapers/Pipeline/Core/PipelineContextFactory.js';
import type { IPipelineDescriptor } from '../../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';

/** Synthetic, unregistered bank — exercises the "no config" branch. */
const UNREGISTERED_BANK = 'synthetic-unregistered' as unknown as CompanyTypes;

/**
 * Build a minimal descriptor for a bank.
 * @param companyId - Company id to plant in options.
 * @returns Minimal descriptor literal.
 */
function makeDescriptor(companyId: CompanyTypes): IPipelineDescriptor {
  const options = { companyId, startDate: new Date('2024-01-01') } as unknown as ScraperOptions;
  return { options, phases: [] };
}

describe('PipelineContextFactory — headless mediator wiring', () => {
  /**
   * The apiMediator slot's outcome per branch: a bank whose config carries the
   * block, a bank the config never registered, and a registered bank. Driven
   * from one table per CLAUDE.md's config-array rule (no duplicated test
   * bodies).
   */
  const apiMediatorCases = [
    {
      name: 'Bank with headless block in config: apiMediator populated',
      companyId: CompanyTypes.OneZero,
      hasMediator: true,
    },
    {
      name: 'Bank missing from config: apiMediator stays none',
      companyId: UNREGISTERED_BANK,
      hasMediator: false,
    },
    {
      name: 'Leumi config: apiMediator populated',
      companyId: CompanyTypes.Leumi,
      hasMediator: true,
    },
  ] as const;

  it.each(apiMediatorCases)('$name', ({ companyId, hasMediator }) => {
    const descriptor = makeDescriptor(companyId);
    const ctx = buildInitialContext(
      descriptor,
      {} as unknown as Parameters<typeof buildInitialContext>[1],
    );
    expect(ctx.apiMediator.has).toBe(hasMediator);
  });

  it('leaves the mediator empty when a registered bank has no headless block', async () => {
    const registry =
      await import('../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
    const bank = CompanyTypes.Leumi;
    const original = registry.PIPELINE_BANK_CONFIG[bank];
    if (original === undefined) throw new TypeError('missing bank configuration');
    const { transport: transportConfig, ...withoutTransport } = original;
    expect(transportConfig).toBeDefined();
    registry.PIPELINE_BANK_CONFIG[bank] = withoutTransport;
    try {
      const descriptor = makeDescriptor(bank);
      const ctx = buildInitialContext(descriptor, { id: 'syn', password: 'syn' });
      expect(ctx.apiMediator.has).toBe(false);
    } finally {
      registry.PIPELINE_BANK_CONFIG[bank] = original;
    }
  });

  it('buildInitialContext returns a well-formed context for an unregistered bank', () => {
    const descriptor = makeDescriptor(UNREGISTERED_BANK);
    const ctx = buildInitialContext(descriptor, { id: 'syn', password: 'syn' });
    expect(ctx.options.companyId).toBe(UNREGISTERED_BANK);
    expect(ctx.apiMediator.has).toBe(false);
    expect(ctx.windowEnd.has).toBe(false);
  });

  /**
   * Cross-bank native-transport matrix: Pepper and PayBox run their identity
   * calls over Node's own fetch, and their ApiMediator exposes NO `dispose`
   * hook. Driven via a single config array
   * per CLAUDE.md's "config arrays mapped with .map() — no duplication" rule.
   * OneZero (node:https mTLS) follows the same contract — see OZ-PCF-01 below.
   */
  const nativeNoDisposeCases = [
    { testId: 'PP-PCF-02', bankName: 'Pepper', companyId: CompanyTypes.Pepper },
    { testId: 'PB-PCF-04', bankName: 'PayBox', companyId: CompanyTypes.PayBox },
  ] as const;

  nativeNoDisposeCases.forEach(({ testId, bankName, companyId }) => {
    it(`${testId} — ${bankName} (nativeFetch=true): mediator exposes no dispose hook`, () => {
      const descriptor = makeDescriptor(companyId);
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

  it('OZ-PCF-01 — OneZero (requiresClientCert=true): mTLS mediator exposes no dispose hook', () => {
    const descriptor = makeDescriptor(CompanyTypes.OneZero);
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
