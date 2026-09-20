/**
 * Cold-flow budget — a scrape run may send at most one SMS.
 *
 * <p>A cold flow replays the bank's login from step 0, and step 0 is where the
 * message is sent. Nothing used to count them. `guardedRefreshOp` reads like a
 * cap but is a re-entrancy latch: it blocks a refresh nested inside a refresh
 * and releases in `finally`, so *sequential* refreshes were unbounded. Every
 * `apiPost`/`apiGet`/`apiQuery` funnels through `retryOn401Op`, and each 401
 * costs one `refresh()` → one `primeFresh` → one more SMS. Ten rejected calls
 * meant ten messages.
 *
 * <p>Repeated `primeFresh` here is not a shortcut for that path, it *is* that
 * path: `TokenResolverBuilder.runFresh` is the mediator's only refresh call
 * site and it does nothing but `strategy.primeFresh(bus, ctx, creds)`.
 *
 * <p>A warm resume starts past the SMS step and must stay free, or the first
 * legitimate warm→cold escalation would be refused before the bank was ever
 * asked.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import type { ScraperCredentials } from '../../../../../../Scrapers/Base/Interface.js';
import ScraperError from '../../../../../../Scrapers/Base/ScraperError.js';
import type { IApiDirectCallConfig } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { COLD_FLOW_BUDGET } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/TokenStrategyFromConfig.budget.js';
import { BUDGET_SPENT_MESSAGE } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/TokenStrategyFromConfig.flow.js';
import type { IConfigTokenStrategy } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/TokenStrategyFromConfig.js';
import { createTokenStrategyFromConfig } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/TokenStrategyFromConfig.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { ITokenContext } from '../../../../../../Scrapers/Pipeline/Types/Domain/TokenContext.js';
import type { Procedure } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, isOk, succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { type IApiPostCapture, makeStubMediator } from './StubMediator.js';
import { makeJwt, WARM_STEP_TAG, warmTwoStepConfig } from './WarmStartFixtures.js';

const HINT = CompanyTypes.OneZero;
const CTX = { companyId: HINT } as unknown as ITokenContext;

/** Steps a cold flow walks in `warmTwoStepConfig` — the whole list. */
const COLD_STEPS = 2;
/** Steps a warm resume walks — everything from `fromStepIndex` on. */
const WARM_STEPS = 1;

beforeAll((): void => {
  registerWkUrl(WARM_STEP_TAG, HINT, 'https://example.test/api/warm-tag');
});

/** A bank answer carrying the bearer each step extracts to carry. */
const STEP_OK: Procedure<unknown> = succeed({ access_token: makeJwt(36000) });

/** Strategy plus the capture log of every request its flows made. */
interface IHarness {
  readonly strategy: IConfigTokenStrategy;
  readonly captures: IApiPostCapture[];
}

/**
 * Build the strategy under test from the shared two-step warm config.
 * @returns Strategy plus an empty capture log.
 */
function makeHarness(): IHarness {
  const proc = createTokenStrategyFromConfig({ config: warmTwoStepConfig() });
  if (!isOk(proc)) throw new ScraperError(proc.errorMessage);
  return { strategy: proc.value, captures: [] };
}

/**
 * Build a bus that answers every step with a bearer, recording each request
 * into the harness log. A fresh bus per prime mirrors production, where the
 * budget lives on the strategy and not on any one mediator.
 * @param harness - Harness whose capture log receives the requests.
 * @returns Stub mediator scripted to succeed for a whole cold flow.
 */
function makeBus(harness: IHarness): ReturnType<typeof makeStubMediator> {
  const responses = [STEP_OK, STEP_OK];
  return makeStubMediator({ responses, captures: harness.captures });
}

/**
 * Run one cold prime — the exact call the mediator makes on every 401.
 * @param harness - Harness under test.
 * @returns Header-value procedure.
 */
async function primeFreshOnce(harness: IHarness): Promise<Procedure<string>> {
  const bus = makeBus(harness);
  const creds = {} as ScraperCredentials;
  return harness.strategy.primeFresh(bus, CTX, creds);
}

/**
 * Run one warm prime, seeded with a locally fresh token.
 * @param harness - Harness under test.
 * @returns Header-value procedure.
 */
async function primeWarmOnce(harness: IHarness): Promise<Procedure<string>> {
  const creds = { otpLongTermToken: makeJwt(36000) } as unknown as ScraperCredentials;
  const bus = makeBus(harness);
  return harness.strategy.primeInitial(bus, CTX, creds);
}

/**
 * Run one cold prime whose very first bank call is refused, so the run spends
 * its budget without ever minting a session.
 * @param harness - Harness under test.
 * @returns Header-value procedure.
 */
async function primeFreshFailing(harness: IHarness): Promise<Procedure<string>> {
  const responses = [fail(ScraperErrorTypes.Generic, 'bank said no')];
  const bus = makeStubMediator({ responses, captures: harness.captures });
  const creds = {} as ScraperCredentials;
  return harness.strategy.primeFresh(bus, CTX, creds);
}

/**
 * Run cold primes back to back, the way sequential 401s drive them.
 * @param harness - Harness under test.
 * @param times - Number of primes to run.
 * @returns true once every prime has run.
 */
async function primeFreshTimes(harness: IHarness, times: number): Promise<true> {
  if (times <= 0) return true;
  await primeFreshOnce(harness);
  return primeFreshTimes(harness, times - 1);
}

describe('cold-flow budget — one SMS per run', (): void => {
  it('runs the first cold flow and contacts the bank', async (): Promise<void> => {
    const harness = makeHarness();
    const proc = await primeFreshOnce(harness);
    expect(proc.success).toBe(true);
    expect(harness.captures).toHaveLength(COLD_STEPS);
  });

  it('refuses a second cold flow in the same run', async (): Promise<void> => {
    const harness = makeHarness();
    await primeFreshOnce(harness);
    const second = await primeFreshOnce(harness);
    expect(harness.captures).toHaveLength(COLD_STEPS);
    expect(second.success).toBe(true);
  });

  it('surrenders the session the run already bought instead of failing', async (): Promise<void> => {
    const harness = makeHarness();
    const first = await primeFreshOnce(harness);
    const second = await primeFreshOnce(harness);
    if (!first.success) throw new ScraperError('expected the first cold flow to succeed');
    if (!second.success) throw new ScraperError('expected the minted session to be surrendered');
    expect(second.value).toBe(first.value);
  });

  it('names the spent budget when the run never minted a session', async (): Promise<void> => {
    const harness = makeHarness();
    await primeFreshFailing(harness);
    const second = await primeFreshOnce(harness);
    if (second.success) throw new ScraperError('expected the second cold flow to be refused');
    expect(second.errorMessage).toBe(BUDGET_SPENT_MESSAGE);
    expect(second.errorType).toBe(ScraperErrorTypes.Generic);
  });

  it('never surrenders a warm session the cold flow did not replace', async (): Promise<void> => {
    const harness = makeHarness();
    await primeWarmOnce(harness);
    await primeFreshFailing(harness);
    const refused = await primeFreshOnce(harness);
    if (refused.success) throw new ScraperError('expected the spent budget to be named');
    expect(refused.errorMessage).toBe(BUDGET_SPENT_MESSAGE);
  });

  it('never contacts the bank for the refused flow', async (): Promise<void> => {
    const harness = makeHarness();
    await primeFreshOnce(harness);
    await primeFreshOnce(harness);
    expect(harness.captures).toHaveLength(COLD_STEPS);
  });

  it('holds the line however many times the session is refused', async (): Promise<void> => {
    const harness = makeHarness();
    const attempts = COLD_FLOW_BUDGET + 3;
    await primeFreshTimes(harness, attempts);
    expect(harness.captures).toHaveLength(COLD_STEPS * COLD_FLOW_BUDGET);
  });

  it('charges the cold branch of the initial prime, not only refreshes', async (): Promise<void> => {
    const harness = makeHarness();
    const bus = makeBus(harness);
    const creds = {} as ScraperCredentials;
    await harness.strategy.primeInitial(bus, CTX, creds);
    await primeFreshOnce(harness);
    expect(harness.captures).toHaveLength(COLD_STEPS);
  });

  it('never charges a warm resume to the budget', async (): Promise<void> => {
    const harness = makeHarness();
    await primeWarmOnce(harness);
    await primeWarmOnce(harness);
    const cold = await primeFreshOnce(harness);
    expect(cold.success).toBe(true);
    expect(harness.captures).toHaveLength(WARM_STEPS + WARM_STEPS + COLD_STEPS);
  });

  it('still allows the cold retry after a warm attempt fails', async (): Promise<void> => {
    const harness = makeHarness();
    await primeWarmOnce(harness);
    const cold = await primeFreshOnce(harness);
    expect(cold.success).toBe(true);
  });

  it('gives every scrape run its own budget', async (): Promise<void> => {
    const first = makeHarness();
    const second = makeHarness();
    await primeFreshOnce(first);
    const laterRun = await primeFreshOnce(second);
    expect(laterRun.success).toBe(true);
    expect(second.captures).toHaveLength(COLD_STEPS);
  });
});

/**
 * Build a config whose cold path must acquire an OTP, so the number of
 * messages a run costs is directly observable as retriever calls.
 *
 * <p>`fromStepIndex: 1` leaves the OTP step on the cold path only, which is
 * what makes a warm resume free.
 * @returns Config with an OTP pre-hook ahead of the resume point.
 */
function otpConfig(): IApiDirectCallConfig {
  const base = warmTwoStepConfig();
  const preHook = { awaitCredsField: 'otpCodeRetriever', intoCarryField: 'otpDigitsPlain' };
  const otpStep = { ...base.steps[0], name: 'assertOtp' as const, preHook };
  return { ...base, steps: [otpStep, base.steps[1]] };
}

/** A retriever bundled with the count of how often the run asked it. */
interface IOtpProbe {
  readonly creds: ScraperCredentials;
  readonly calls: { n: number };
}

/**
 * Build credentials whose OTP retriever counts every acquisition.
 *
 * <p>One call means one delivered message: the bank sends the SMS at the step
 * that precedes it, and the retriever is what collects the result.
 * @returns Credentials plus the live call counter.
 */
function makeOtpProbe(): IOtpProbe {
  const calls = { n: 0 };
  /**
   * Answer with fixed digits, recording the acquisition.
   * @returns The delivered code.
   */
  async function otpCodeRetriever(): Promise<string> {
    await Promise.resolve();
    calls.n = calls.n + 1;
    return '481902';
  }
  return { creds: { otpCodeRetriever } as unknown as ScraperCredentials, calls };
}

describe('cold-flow budget — the consumed-code replay is unreachable', (): void => {
  it('asks for an OTP once however often the session is refused', async (): Promise<void> => {
    const proc = createTokenStrategyFromConfig({ config: otpConfig() });
    if (!isOk(proc)) throw new ScraperError(proc.errorMessage);
    const harness: IHarness = { strategy: proc.value, captures: [] };
    const probe = makeOtpProbe();
    const refusals = [makeBus(harness), makeBus(harness), makeBus(harness)];
    await harness.strategy.primeFresh(refusals[0], CTX, probe.creds);
    await harness.strategy.primeFresh(refusals[1], CTX, probe.creds);
    await harness.strategy.primeFresh(refusals[2], CTX, probe.creds);
    expect(probe.calls.n).toBe(1);
  });
});
