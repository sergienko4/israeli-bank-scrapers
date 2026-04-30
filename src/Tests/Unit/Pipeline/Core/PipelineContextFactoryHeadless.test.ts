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
});
