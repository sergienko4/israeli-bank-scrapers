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
  it('HTML bank (isHeadless=false): apiMediator slot stays none', () => {
    const descriptor = makeDescriptor(false, CompanyTypes.Discount);
    const ctx = buildInitialContext(
      descriptor,
      {} as unknown as Parameters<typeof buildInitialContext>[1],
    );
    expect(ctx.apiMediator.has).toBe(false);
  });

  it('Headless bank with headless block in config: apiMediator populated', () => {
    const descriptor = makeDescriptor(true, CompanyTypes.OneZero);
    const ctx = buildInitialContext(
      descriptor,
      {} as unknown as Parameters<typeof buildInitialContext>[1],
    );
    expect(ctx.apiMediator.has).toBe(true);
  });

  it('Headless flag but bank missing from config: apiMediator stays none', () => {
    const descriptor = makeDescriptor(true, UNREGISTERED_BANK);
    const ctx = buildInitialContext(
      descriptor,
      {} as unknown as Parameters<typeof buildInitialContext>[1],
    );
    expect(ctx.apiMediator.has).toBe(false);
  });

  it('Headless flag but bank has no headless block: apiMediator stays none', () => {
    const descriptor = makeDescriptor(true, CompanyTypes.Discount);
    const ctx = buildInitialContext(
      descriptor,
      {} as unknown as Parameters<typeof buildInitialContext>[1],
    );
    expect(ctx.apiMediator.has).toBe(false);
  });

  it('buildInitialContext returns a well-formed context (non-headless default)', () => {
    const descriptor = makeDescriptor(false, CompanyTypes.Discount);
    const ctx = buildInitialContext(descriptor, { id: 'syn', password: 'syn' });
    expect(ctx.options.companyId).toBe(CompanyTypes.Discount);
    expect(ctx.browser.has).toBe(false);
    expect(ctx.mediator.has).toBe(false);
    expect(ctx.apiMediator.has).toBe(false);
    expect(ctx.loginAreaReady).toBe(false);
  });

  /**
   * Cross-bank TLS-dispose matrix: every `requiresBrowserTls=true`
   * bank must expose a `dispose` hook on its headless ApiMediator so
   * the pipeline can tear down the browser-backed TLS context. Driven
   * via a single config array per CLAUDE.md's "config arrays mapped
   * with .map() — no duplication" rule.
   */
  const tlsDisposeCases = [
    { testId: 'OZ-PCF-01', bankName: 'OneZero', companyId: CompanyTypes.OneZero },
    { testId: 'PP-PCF-02', bankName: 'Pepper', companyId: CompanyTypes.Pepper },
  ] as const;

  tlsDisposeCases.forEach(({ testId, bankName, companyId }) => {
    it(`${testId} — ${bankName} (requiresBrowserTls=true): mediator exposes dispose hook`, () => {
      const descriptor = makeDescriptor(true, companyId);
      const ctx = buildInitialContext(
        descriptor,
        {} as unknown as Parameters<typeof buildInitialContext>[1],
      );
      expect(ctx.apiMediator.has).toBe(true);
      if (ctx.apiMediator.has) {
        expect(typeof ctx.apiMediator.value.dispose).toBe('function');
      }
    });
  });

  it('OZ-PCF-03 — Hapoalim (non-headless): apiMediator slot stays none', () => {
    const descriptor = makeDescriptor(false, CompanyTypes.Hapoalim);
    const ctx = buildInitialContext(
      descriptor,
      {} as unknown as Parameters<typeof buildInitialContext>[1],
    );
    expect(ctx.apiMediator.has).toBe(false);
  });
});
