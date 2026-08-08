/**
 * T-PREHOOK-REUSE — the library must ask for a one-time secret exactly once
 * per login, however many steps submit it.
 *
 * <p>Why this test exists at all: PayBox's real-E2E test already passed while
 * this defect was live, because the test harness (`src/Tests/E2eReal/
 * OtpPoller.ts`) memoises the retriever itself. The harness compensated for
 * the library, so a green run proved only that the harness worked. These cases
 * call `applyPreHook` directly with a plain counting retriever — the shape a
 * real caller writes — so nothing can mask a regression.
 *
 * <p>Modelled on PayBox: `/pinValidation` and `/loginBySms` both encrypt the
 * same delivered OTP into `/pin` under different IVs, and each scrubs the
 * plaintext from carry, so the second step must re-acquire it.
 */

import type { IPreStepHook } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/EnvelopeTypes.js';
import { applyPreHook } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/SmsOtpFlow.prehook.js';
import { createPreHookCache } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/SmsOtpFlow.prehookCache.js';
import type { ITemplateScope } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';
import { isOk } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';

/** The digits a single delivered SMS carries. */
const DELIVERED_CODE = '481902';

/** Local error type — the house rule bans a bare `throw new Error()`. */
class RetrieverTestError extends Error {}

/** Mutable call counter, read by the assertions. */
interface ICounter {
  n: number;
}

/** A probe retriever bundled with the counter recording how often it ran. */
interface IRetrieverProbe {
  readonly creds: Record<string, unknown>;
  readonly counter: ICounter;
}

/**
 * Empty scope seed — carry starts clean, as at the top of a login flow.
 * @returns A template scope whose carry holds nothing.
 */
function emptyScope(): ITemplateScope {
  return { carry: {} } as unknown as ITemplateScope;
}

/**
 * Build a hook awaiting `otpCodeRetriever`, mirroring PayBox's two steps.
 * @param reuse - Optional explicit reuse mode; omitted means "take the default".
 * @returns Pre-step hook config.
 */
function otpHook(reuse?: 'per-flow' | 'per-step'): IPreStepHook {
  const base = { awaitCredsField: 'otpCodeRetriever', intoCarryField: 'otpDigitsPlain' };
  if (reuse === undefined) return base;
  return { ...base, reuse };
}

/**
 * A retriever answering `limit` times then rejecting — the shape of a one-time
 * SMS code that the bank never re-delivers.
 * @param field - Credentials field the hook awaits.
 * @param limit - How many calls can be answered.
 * @returns The credentials bag and its call counter.
 */
function makeRetriever(field: string, limit: number): IRetrieverProbe {
  const counter: ICounter = { n: 0 };
  /**
   * Answer with the delivered digits until the limit is spent.
   * @returns The delivered digits, or a rejection once past `limit`.
   */
  const fn = (): Promise<string> => {
    counter.n += 1;
    if (counter.n > limit)
      return Promise.reject(new RetrieverTestError('no further code delivered'));
    return Promise.resolve(DELIVERED_CODE);
  };
  return { creds: { [field]: fn }, counter };
}

/**
 * A retriever whose leading `failures` calls reject before it starts answering.
 * @param failures - How many leading calls reject.
 * @returns The credentials bag and its call counter.
 */
function makeFailingRetriever(failures: number): IRetrieverProbe {
  const counter: ICounter = { n: 0 };
  /**
   * Reject while the leading failures remain, then answer.
   * @returns Digits once the leading failures are exhausted.
   */
  const fn = (): Promise<string> => {
    counter.n += 1;
    if (counter.n <= failures) return Promise.reject(new RetrieverTestError('transport down'));
    return Promise.resolve(DELIVERED_CODE);
  };
  return { creds: { otpCodeRetriever: fn }, counter };
}

describe('applyPreHook — one delivered secret, one prompt (T-PREHOOK-REUSE)', () => {
  it('T-PREHOOK-REUSE-1: invokes the retriever once across two steps', async () => {
    const probe = makeRetriever('otpCodeRetriever', 1);
    const cache = createPreHookCache();
    const hook = otpHook();
    await applyPreHook({ scope: emptyScope(), creds: probe.creds, hook, cache });
    await applyPreHook({ scope: emptyScope(), creds: probe.creds, hook, cache });
    expect(probe.counter.n).toBe(1);
  });

  it('T-PREHOOK-REUSE-2: the second step still receives the delivered digits', async () => {
    const probe = makeRetriever('otpCodeRetriever', 1);
    const cache = createPreHookCache();
    const hook = otpHook();
    await applyPreHook({ scope: emptyScope(), creds: probe.creds, hook, cache });
    const second = await applyPreHook({ scope: emptyScope(), creds: probe.creds, hook, cache });
    const digits = isOk(second) ? second.value.carry.otpDigitsPlain : '';
    expect(digits).toBe(DELIVERED_CODE);
  });

  it('T-PREHOOK-REUSE-3: a single-shot retriever completes both steps', async () => {
    const probe = makeRetriever('otpCodeRetriever', 1);
    const cache = createPreHookCache();
    const hook = otpHook();
    const first = await applyPreHook({ scope: emptyScope(), creds: probe.creds, hook, cache });
    const second = await applyPreHook({ scope: emptyScope(), creds: probe.creds, hook, cache });
    expect([isOk(first), isOk(second)]).toEqual([true, true]);
  });

  it('T-PREHOOK-REUSE-4: a fresh cache prompts again (retry after a bad code)', async () => {
    const probe = makeRetriever('otpCodeRetriever', 2);
    const hook = otpHook();
    await applyPreHook({
      scope: emptyScope(),
      creds: probe.creds,
      hook,
      cache: createPreHookCache(),
    });
    await applyPreHook({
      scope: emptyScope(),
      creds: probe.creds,
      hook,
      cache: createPreHookCache(),
    });
    expect(probe.counter.n).toBe(2);
  });

  it('T-PREHOOK-REUSE-5: hooks awaiting different fields do not share an entry', async () => {
    const otp = makeRetriever('otpCodeRetriever', 1);
    const pin = makeRetriever('pinRetriever', 1);
    const creds = { ...otp.creds, ...pin.creds };
    const cache = createPreHookCache();
    const pinHook = { awaitCredsField: 'pinRetriever', intoCarryField: 'pinPlain' };
    await applyPreHook({ scope: emptyScope(), creds, hook: otpHook(), cache });
    await applyPreHook({ scope: emptyScope(), creds, hook: pinHook, cache });
    expect([otp.counter.n, pin.counter.n]).toEqual([1, 1]);
  });

  it('T-PREHOOK-REUSE-6: reuse per-step opts out and re-acquires', async () => {
    const probe = makeRetriever('otpCodeRetriever', 2);
    const cache = createPreHookCache();
    const hook = otpHook('per-step');
    await applyPreHook({ scope: emptyScope(), creds: probe.creds, hook, cache });
    await applyPreHook({ scope: emptyScope(), creds: probe.creds, hook, cache });
    expect(probe.counter.n).toBe(2);
  });
});

describe('applyPreHook — failure handling (T-PREHOOK-REUSE-7/8)', () => {
  it('T-PREHOOK-REUSE-7: a failed acquisition is evicted so a later call retries', async () => {
    const probe = makeFailingRetriever(1);
    const cache = createPreHookCache();
    const hook = otpHook();
    const first = await applyPreHook({ scope: emptyScope(), creds: probe.creds, hook, cache });
    const second = await applyPreHook({ scope: emptyScope(), creds: probe.creds, hook, cache });
    expect([isOk(first), isOk(second)]).toEqual([false, true]);
  });

  it('T-PREHOOK-REUSE-8: a first-invocation throw keeps the legacy message', async () => {
    const probe = makeFailingRetriever(1);
    const cache = createPreHookCache();
    const hook = otpHook();
    const result = await applyPreHook({ scope: emptyScope(), creds: probe.creds, hook, cache });
    const message = isOk(result) ? '' : result.errorMessage;
    // Single-hook flows (OneZero, Pepper) only ever reach invocation #1, so
    // their failure text must stay byte-identical to the long-standing one.
    expect(message).toBe('preHook: creds.otpCodeRetriever() threw: transport down');
  });

  it('T-PREHOOK-REUSE-9: a failure evicts, and the retry names the ordinal', async () => {
    const probe = makeFailingRetriever(2);
    const cache = createPreHookCache();
    const hook = otpHook();
    await applyPreHook({ scope: emptyScope(), creds: probe.creds, hook, cache });
    const second = await applyPreHook({ scope: emptyScope(), creds: probe.creds, hook, cache });
    const message = isOk(second) ? '' : second.errorMessage;
    // Reaching invocation #2 at all proves the failed entry was evicted; the
    // ordinal is what distinguishes a single-shot caller from a dead transport.
    expect(message).toContain('invocation #2 of this login');
  });

  it('T-PREHOOK-REUSE-10: concurrent misses share one in-flight acquisition', async () => {
    // The retriever answers exactly once, so a leaked second acquisition would
    // reject rather than quietly re-prompt — sharing is proven by both counts
    // and outcomes.
    const probe = makeRetriever('otpCodeRetriever', 1);
    const cache = createPreHookCache();
    const hook = otpHook();
    const args = { scope: emptyScope(), creds: probe.creds, hook, cache };
    const [first, second] = await Promise.all([applyPreHook(args), applyPreHook(args)]);
    const digits = [first, second].map(r => (isOk(r) ? r.value.carry.otpDigitsPlain : ''));
    expect({ calls: probe.counter.n, digits }).toEqual({
      calls: 1,
      digits: [DELIVERED_CODE, DELIVERED_CODE],
    });
  });

  it('T-PREHOOK-REUSE-11: concurrent awaiters of a failure both fail, then re-prompt', async () => {
    const probe = makeFailingRetriever(2);
    const cache = createPreHookCache();
    const hook = otpHook();
    const args = { scope: emptyScope(), creds: probe.creds, hook, cache };
    const results = await Promise.all([applyPreHook(args), applyPreHook(args)]);
    await applyPreHook(args);
    // One shared rejection must not poison the cache: the next attempt prompts.
    expect({ failed: results.filter(r => !isOk(r)).length, calls: probe.counter.n }).toEqual({
      failed: 2,
      calls: 2,
    });
  });
});
