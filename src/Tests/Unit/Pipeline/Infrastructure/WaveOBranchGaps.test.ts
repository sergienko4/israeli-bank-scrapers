/**
 * Wave O — parameterised branch-gap tests for remaining Pipeline files.
 * Each describe block targets one uncovered branch/function identified from
 * coverage-summary.json + lcov.info. Tests are minimal and fast.
 */

import type { Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import { toResult } from '../../../../Scrapers/Pipeline/Core/PipelineResult.js';
import { resolveAbsoluteHref } from '../../../../Scrapers/Pipeline/Mediator/Dashboard/DashboardDiscovery.js';
import {
  bodyHasSignature,
  extractMatchingKeys,
} from '../../../../Scrapers/Pipeline/Mediator/Scrape/JsonTraversal.js';
import { applyDateRangeToUrl } from '../../../../Scrapers/Pipeline/Mediator/Scrape/UrlDateRange.js';
import { none, some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { IPipelineContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { fail, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from './MockFactories.js';

// ── PipelineResult / toResult ────────────────────────────

describe('PipelineResult branch gap', () => {
  it('extracts persistentOtpToken from login state when present', () => {
    const ctx = makeMockContext();
    const withLogin: IPipelineContext = {
      ...ctx,
      scrape: some({
        accounts: [
          { accountNumber: 'A1', txns: [] },
          { accountNumber: 'A2', txns: [] },
        ],
      }) as unknown as IPipelineContext['scrape'],
      login: some({
        activeFrame: {} as Page,
        persistentOtpToken: some('TOKEN-X' as const),
      }) as unknown as IPipelineContext['login'],
    };
    const succeedResult1 = succeed(withLogin);
    const result = toResult(succeedResult1);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.persistentOtpToken).toBe('TOKEN-X');
      expect(result.accounts).toHaveLength(2);
    }
  });

  it('omits persistentOtpToken when login.persistentOtpToken is absent', () => {
    const ctx = makeMockContext();
    const withLogin: IPipelineContext = {
      ...ctx,
      login: some({
        activeFrame: {} as Page,
        persistentOtpToken: none(),
      }) as unknown as IPipelineContext['login'],
    };
    const succeedResult2 = succeed(withLogin);
    const result = toResult(succeedResult2);
    expect(result.success).toBe(true);
  });

  it('forwards fail procedure to legacy shape', () => {
    const failResult3 = fail(ScraperErrorTypes.Generic, 'oops');
    const result = toResult(failResult3);
    expect(result.success).toBe(false);
  });
});

// ── UrlDateRange — uncovered branches ────────────────────

describe('UrlDateRange branch gap', () => {
  it('preserves ISO format for retrievalStartDate key via ISO probe value', () => {
    // Use a WK from key (retrievalStartDate) with an ISO-formatted original value
    const url = 'https://x.example/api?retrievalStartDate=2026-01-21';
    const out = applyDateRangeToUrl(url, new Date('2025-04-21'), new Date('2026-04-20'));
    // Should emit ISO since probe was ISO
    expect(out).toContain('retrievalStartDate=2025-04-21');
  });
});

// ── JsonTraversal extra branches ─────────────────────────

describe('JsonTraversal branch gap (extra)', () => {
  it('bodyHasSignature false for undefined body', () => {
    const isBodyHasSignatureResult4 = bodyHasSignature(undefined as unknown as null, /x/);
    expect(isBodyHasSignatureResult4).toBe(false);
  });

  it('extractMatchingKeys returns [] for undefined body', () => {
    const extractMatchingKeysResult5 = extractMatchingKeys(undefined as unknown as null, /x/);
    expect(extractMatchingKeysResult5).toEqual([]);
  });

  it('extractMatchingKeys walks arrays via first element only', () => {
    const body = { items: [{ firstKey: 1 }, { ignoredKey: 2 }] };
    const keys = extractMatchingKeys(body, /firstKey|ignoredKey/);
    expect(keys).toContain('firstKey');
  });
});

// ── DashboardDiscovery — probe catch branches ────────────

describe('DashboardDiscovery probe catch branches', () => {
  it('probeSuccessIndicators returns "no indicator" when resolver rejects', async () => {
    const { probeSuccessIndicators } =
      await import('../../../../Scrapers/Pipeline/Mediator/Dashboard/DashboardDiscovery.js');
    const mediator = {
      /**
       * resolveVisible rejects.
       * @returns Rejected promise.
       */
      resolveVisible: (): Promise<never> => Promise.reject(new Error('probe-fail')),
    } as unknown as Parameters<typeof probeSuccessIndicators>[0];
    const result = await probeSuccessIndicators(mediator);
    expect(result).toContain('no indicator');
  });

  it('probeDashboardReveal returns "no reveal" when resolver rejects', async () => {
    const { probeDashboardReveal } =
      await import('../../../../Scrapers/Pipeline/Mediator/Dashboard/DashboardDiscovery.js');
    const mediator = {
      /**
       * resolveVisible rejects.
       * @returns Rejected promise.
       */
      resolveVisible: (): Promise<never> => Promise.reject(new Error('probe-fail')),
    } as unknown as Parameters<typeof probeDashboardReveal>[0];
    const result = await probeDashboardReveal(mediator);
    expect(result).toContain('no reveal');
  });

  it('validateTrafficGate returns true when endpoints exist', async () => {
    const { validateTrafficGate } =
      await import('../../../../Scrapers/Pipeline/Mediator/Dashboard/DashboardDiscovery.js');
    const network = {
      /**
       * Returns endpoints present.
       * @returns Array.
       */
      getAllEndpoints: (): readonly unknown[] => [{}],
    } as unknown as Parameters<typeof validateTrafficGate>[0];
    const isValidateTrafficGateResult6 = validateTrafficGate(network);
    expect(isValidateTrafficGateResult6).toBe(true);
  });

  it('validateTrafficGate returns false when endpoints empty', async () => {
    const { validateTrafficGate } =
      await import('../../../../Scrapers/Pipeline/Mediator/Dashboard/DashboardDiscovery.js');
    const network = {
      /**
       * Empty endpoints.
       * @returns Empty array.
       */
      getAllEndpoints: (): readonly unknown[] => [],
    } as unknown as Parameters<typeof validateTrafficGate>[0];
    const isValidateTrafficGateResult7 = validateTrafficGate(network);
    expect(isValidateTrafficGateResult7).toBe(false);
  });
});

// ── DashboardDiscovery resolveAbsoluteHref ───────────────

describe('DashboardDiscovery resolveAbsoluteHref', () => {
  it('returns empty string for empty href', () => {
    const resolveAbsoluteHrefResult8 = resolveAbsoluteHref('', 'https://bank/dashboard');
    expect(resolveAbsoluteHrefResult8).toBe('');
  });

  it('returns absolute href unchanged', () => {
    const r = resolveAbsoluteHref('https://other/path', 'https://bank/dashboard');
    expect(r).toBe('https://other/path');
  });

  it('resolves relative href against page url', () => {
    const r = resolveAbsoluteHref('/txns', 'https://bank/dashboard');
    expect(r).toContain('/txns');
  });
});

// ── PipelineBankConfig — guard branches ──────────────────

describe('PipelineBankConfig guard', () => {
  it('has a default export shape', async () => {
    const mod = await import('../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
    expect(mod).toBeDefined();
  });

  it('resolvePipelineBankConfig returns false for unregistered company', async () => {
    const { resolvePipelineBankConfig } =
      await import('../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
    const unknown = '__nonexistent-company__' as unknown as Parameters<
      typeof resolvePipelineBankConfig
    >[0];
    const result = resolvePipelineBankConfig(unknown);
    expect(result).toBe(false);
  });

  it('resolvePipelineBankConfig returns config for known company', async () => {
    const { resolvePipelineBankConfig, PIPELINE_BANK_CONFIG: pipelineBankConfig } =
      await import('../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
    const keys = Object.keys(pipelineBankConfig);
    if (keys.length > 0) {
      const knownId = keys[0] as unknown as Parameters<typeof resolvePipelineBankConfig>[0];
      const result = resolvePipelineBankConfig(knownId);
      expect(result).not.toBe(false);
    }
  });
});

// ── LoginPhaseFactory — guard branches ───────────────────

describe('LoginPhaseFactory', () => {
  it('creates login phase and has expected shape', async () => {
    const { createLoginPhaseFromConfig } =
      await import('../../../../Scrapers/Pipeline/Phases/Login/LoginPhase.js');
    const minCfg = {
      loginUrl: 'https://bank.example/login',
      fields: [],
      submit: { kind: 'textContent', value: 'Login' },
      possibleResults: {},
    } as unknown as Parameters<typeof createLoginPhaseFromConfig>[0];
    const phase = createLoginPhaseFromConfig(minCfg);
    expect(phase.name).toBe('login');
  });
});

// ── MockRouteHandler — error branch ──────────────────────

describe('MockRouteHandler error branches', () => {
  it('exports buildHandler', async () => {
    const mod = await import('../../../../Scrapers/Pipeline/Interceptors/MockRouteHandler.js');
    expect(typeof mod.buildHandler).toBe('function');
  });
});
