/**
 * Unit tests for PipelineContextFactory's HTTP-mediator wiring —
 * covers the branches driven off the resolved bank config.
 */

import { jest } from '@jest/globals';

import { CompanyTypes } from '../../../../Definitions.js';
import type { ScraperOptions } from '../../../../Scrapers/Base/Interface.js';
import type { IPipelineDescriptor } from '../../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';

/** One bank's pipeline config, as the resolver returns it. */
interface IBankConfig {
  readonly urls: { readonly base: string };
  readonly transport?: {
    readonly identityBase: string;
    readonly graphql: string;
    readonly paths: Readonly<Record<string, string>>;
    readonly nativeFetch?: boolean;
    readonly clientCert?: { readonly mode: 'dynamic'; readonly origin: string };
  };
}

/** Synthetic, unregistered bank — exercises the "no config" branch. */
const UNREGISTERED_BANK = 'synthetic-unregistered' as unknown as CompanyTypes;

/** Synthetic wiring configs: only the transport block matters here. */
const CONFIGS: Partial<Record<CompanyTypes, IBankConfig>> = {
  [CompanyTypes.OneZero]: {
    urls: { base: 'https://www.onezerobank.com' },
    transport: {
      identityBase: 'https://identity.onezero.example',
      graphql: 'https://graphql.onezero.example',
      paths: {},
      clientCert: { mode: 'dynamic', origin: 'https://identity.onezero.example' },
    },
  },
  [CompanyTypes.Pepper]: {
    urls: { base: 'https://www.pepper.co.il' },
    transport: {
      identityBase: 'https://identity.pepper.example',
      graphql: 'https://graphql.pepper.example',
      paths: {},
      nativeFetch: true,
    },
  },
  [CompanyTypes.PayBox]: {
    urls: { base: 'https://www.payboxapp.com/' },
    transport: {
      identityBase: 'https://apipin.payboxapp.com/api/2.0/',
      graphql: 'https://apipin.payboxapp.com/api/2.0/',
      paths: {},
      nativeFetch: true,
    },
  },
  [CompanyTypes.Leumi]: { urls: { base: 'https://www.leumi.co.il' } },
};

/**
 * Resolve from the synthetic table above; Leumi deliberately has no transport.
 * @param companyId - Bank named in the descriptor.
 * @returns Its config, or false when unregistered.
 */
function resolveMocked(companyId: CompanyTypes): IBankConfig | false {
  return CONFIGS[companyId] ?? false;
}

jest.unstable_mockModule(
  '../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js',
  () => ({ resolvePipelineBankConfig: resolveMocked }),
);

const PIPELINE_CONTEXT_FACTORY =
  await import('../../../../Scrapers/Pipeline/Core/PipelineContextFactory.js');
const BUILD_INITIAL_CONTEXT = PIPELINE_CONTEXT_FACTORY.default;

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
      name: 'Pepper config: apiMediator populated',
      companyId: CompanyTypes.Pepper,
      hasMediator: true,
    },
  ] as const;

  it.each(apiMediatorCases)('$name', ({ companyId, hasMediator }) => {
    const descriptor = makeDescriptor(companyId);
    const ctx = BUILD_INITIAL_CONTEXT(
      descriptor,
      {} as unknown as Parameters<typeof BUILD_INITIAL_CONTEXT>[1],
    );
    expect(ctx.apiMediator.has).toBe(hasMediator);
  });

  it('leaves the mediator empty when a registered bank has no headless block', () => {
    const descriptor = makeDescriptor(CompanyTypes.Leumi);
    const ctx = BUILD_INITIAL_CONTEXT(descriptor, { id: 'syn', password: 'syn' });
    expect(ctx.apiMediator.has).toBe(false);
  });

  it('BUILD_INITIAL_CONTEXT returns a well-formed context for an unregistered bank', () => {
    const descriptor = makeDescriptor(UNREGISTERED_BANK);
    const ctx = BUILD_INITIAL_CONTEXT(descriptor, { id: 'syn', password: 'syn' });
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
      const ctx = BUILD_INITIAL_CONTEXT(
        descriptor,
        {} as unknown as Parameters<typeof BUILD_INITIAL_CONTEXT>[1],
      );
      expect(ctx.apiMediator.has).toBe(true);
      if (ctx.apiMediator.has) {
        expect(ctx.apiMediator.value.dispose).toBeUndefined();
      }
    });
  });

  it('OZ-PCF-01 — OneZero (dynamic client certificate): mTLS mediator exposes no dispose hook', () => {
    const descriptor = makeDescriptor(CompanyTypes.OneZero);
    const ctx = BUILD_INITIAL_CONTEXT(
      descriptor,
      {} as unknown as Parameters<typeof BUILD_INITIAL_CONTEXT>[1],
    );
    expect(ctx.apiMediator.has).toBe(true);
    if (ctx.apiMediator.has) {
      expect(ctx.apiMediator.value.dispose).toBeUndefined();
    }
  });
});
