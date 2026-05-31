/**
 * Unit tests for createWafChallengeInterceptor — factory shape + lifecycle.
 *
 * <p>The interceptor MUST:
 *   - have a stable name "waf-challenge"
 *   - expose async beforePhase + afterPipeline
 *   - return fresh per-instance state on every call (so two scrapers running
 *     concurrently never share solving / cooldown / attached state)
 *   - degrade safely (succeed) when no browser is in the context
 *   - degrade safely (succeed) when WAF_INTERCEPTOR_DISABLED env is on
 */

import { WAF_INTERCEPTOR_DISABLED_ENV } from '../../../../../Scrapers/Pipeline/Interceptors/WafChallenge/WafChallengeConfig.js';
import createDefault, {
  createWafChallengeInterceptor,
} from '../../../../../Scrapers/Pipeline/Interceptors/WafChallenge/WafChallengeInterceptor.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';
import { clearDisableEnv } from './WafChallengeTestHelpers.js';

describe('WafChallengeInterceptor.factory', () => {
  it('default and named exports are the same function', () => {
    expect(createDefault).toBe(createWafChallengeInterceptor);
  });

  it('returns an interceptor with stable name "waf-challenge"', () => {
    const inst = createWafChallengeInterceptor();
    expect(inst.name).toBe('waf-challenge');
  });

  it('exposes beforePhase as a function', () => {
    const inst = createWafChallengeInterceptor();
    const kind = typeof inst.beforePhase;
    expect(kind).toBe('function');
  });

  it('exposes afterPipeline as a function (optional in the interface)', () => {
    const inst = createWafChallengeInterceptor();
    const kind = typeof inst.afterPipeline;
    expect(kind).toBe('function');
  });

  it('creates independent instances per call (no shared identity)', () => {
    const a = createWafChallengeInterceptor();
    const b = createWafChallengeInterceptor();
    expect(a).not.toBe(b);
  });
});

describe('WafChallengeInterceptor.beforePhase', () => {
  let originalValue: string | undefined;

  beforeEach(() => {
    originalValue = process.env[WAF_INTERCEPTOR_DISABLED_ENV];
  });

  afterEach(() => {
    process.env[WAF_INTERCEPTOR_DISABLED_ENV] = originalValue ?? '';
  });

  it('returns succeed when there is no browser on the context', async () => {
    clearDisableEnv();
    const inst = createWafChallengeInterceptor();
    const ctx = makeMockContext();
    const result = await inst.beforePhase(ctx, 'init');
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('returns succeed when env disables the interceptor', async () => {
    process.env[WAF_INTERCEPTOR_DISABLED_ENV] = '1';
    const inst = createWafChallengeInterceptor();
    const ctx = makeMockContext();
    const result = await inst.beforePhase(ctx, 'login');
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('succeeds for every standard phase name (phase-agnostic by contract)', async () => {
    clearDisableEnv();
    const inst = createWafChallengeInterceptor();
    const ctx = makeMockContext();
    const phases = ['init', 'home', 'pre-login', 'login', 'otp', 'dashboard', 'scrape'];
    /**
     * Invoke beforePhase for one phase name.
     * @param phase - The phase name to test.
     * @returns Promise that resolves with the beforePhase result.
     */
    function runOne(phase: string): Promise<Procedure<IPipelineContext>> {
      const fn = inst.beforePhase.bind(inst);
      return fn(ctx, phase);
    }
    const calls = phases.map(runOne);
    const results = await Promise.all(calls);
    const wasAllOk = results.every(isOk);
    expect(wasAllOk).toBe(true);
  });
});

describe('WafChallengeInterceptor.afterPipeline', () => {
  it('returns succeed(true) even when no browser is present', async () => {
    const inst = createWafChallengeInterceptor();
    const after = inst.afterPipeline?.bind(inst);
    if (after === undefined) throw new TypeError('afterPipeline must be defined');
    const ctx = makeMockContext();
    const result = await after(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });
});
