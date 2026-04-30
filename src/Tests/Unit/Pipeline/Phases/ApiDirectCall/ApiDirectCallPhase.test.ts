/**
 * Unit tests for ApiDirectCallPhase — the thin orchestration wrapper
 * that delegates PRE / ACTION / POST / FINAL to
 * ApiDirectCallActions. Verifies the 4 hooks flow back to succeed
 * when the bound config + context are valid.
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import type { IApiDirectCallConfig } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/IApiDirectCallConfig.js';
import { createApiDirectCallPhase } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectCall/ApiDirectCallPhase.js';
import type { WKUrlGroup } from '../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { registerWkUrl } from '../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IActionContext,
  IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';
import { makeStubMediator } from '../../Mediator/ApiDirectCall/Flow/StubMediator.js';

const ASSERT_TAG: WKUrlGroup = 'auth.assert';

/**
 * Register the synthetic WK url before any test in this suite runs.
 * Returns the registered tag so the function has a meaningful value
 * (Rule #15 — no primitive `void` returns in Pipeline-adjacent code).
 * @returns The WK tag that was registered.
 */
function registerSuiteWk(): WKUrlGroup {
  registerWkUrl(ASSERT_TAG, CompanyTypes.OneZero, 'https://example.test/api/phase-assert');
  return ASSERT_TAG;
}

beforeAll(registerSuiteWk);

/**
 * Minimal IApiDirectCallConfig — single step + empty probe.
 * @returns Config literal.
 */
function makeConfig(): IApiDirectCallConfig {
  return {
    flow: 'sms-otp',
    envelope: {},
    probe: {},
    steps: [
      {
        name: 'getIdToken',
        urlTag: ASSERT_TAG,
        body: { shape: {} },
        extractsToCarry: { token: '/access_token' },
      },
    ],
  };
}

/**
 * Build a context carrying a stub api-mediator with the given bearer.
 * @param bearer - Bearer string the stub primeSession resolves with.
 * @returns IPipelineContext.
 */
function makePhaseCtx(bearer: string): IPipelineContext {
  const captures = [] as never[];
  const bus = makeStubMediator({ responses: [], captures, primeBearer: bearer });
  const base = makeMockContext();
  return {
    ...base,
    apiMediator: some(bus) as unknown as IPipelineContext['apiMediator'],
  };
}

describe('ApiDirectCallPhase pre hook', () => {
  it('delegates to runApiDirectCallPre and succeeds with classification', async (): Promise<void> => {
    const config = makeConfig();
    const phase = createApiDirectCallPhase(config);
    const ctx = makePhaseCtx('tok');
    const result = await phase.pre(ctx, ctx);
    expect(result.success).toBe(true);
  });
});

describe('ApiDirectCallPhase action hook', () => {
  it('delegates to runApiDirectCallAction and succeeds on non-empty bearer', async (): Promise<void> => {
    const config = makeConfig();
    const phase = createApiDirectCallPhase(config);
    const ctx = makePhaseCtx('tok-action');
    const actionCtx = ctx as unknown as IActionContext;
    const result = await phase.action(actionCtx, actionCtx);
    expect(result.success).toBe(true);
  });

  it('fails when bearer is empty (ACTION empty header)', async (): Promise<void> => {
    const config = makeConfig();
    const phase = createApiDirectCallPhase(config);
    const ctx = makePhaseCtx('');
    const actionCtx = ctx as unknown as IActionContext;
    const result = await phase.action(actionCtx, actionCtx);
    expect(result.success).toBe(false);
  });
});

describe('ApiDirectCallPhase post hook', () => {
  it('delegates to runApiDirectCallPost and fails when probe config missing', async (): Promise<void> => {
    const config = makeConfig();
    const phase = createApiDirectCallPhase(config);
    const ctx = makePhaseCtx('tok');
    const result = await phase.post(ctx, ctx);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('probe config missing');
  });
});

describe('ApiDirectCallPhase final hook', () => {
  it('succeeds unconditionally', async (): Promise<void> => {
    const config = makeConfig();
    const phase = createApiDirectCallPhase(config);
    const ctx = makePhaseCtx('tok');
    const result = await phase.final(ctx, ctx);
    expect(result.success).toBe(true);
  });
});

describe('ApiDirectCallPhase metadata', () => {
  it('exposes the name literal "api-direct-call"', async (): Promise<void> => {
    await Promise.resolve();
    const config = makeConfig();
    const phase = createApiDirectCallPhase(config);
    expect(phase.name).toBe('api-direct-call');
  });
});
