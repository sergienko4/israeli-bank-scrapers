/**
 * ApiDirectScrape PRIME step — unit coverage for the post-login navigation
 * hook. Proves the driver navigates the live login page to a bank's
 * declared SPA route (and settles), and no-ops for shapes without `prime`
 * or without a bound executor (headless banks). Mediator + shape are
 * synthetic casts so the test is self-contained and carries zero PII.
 */

import type { IActionMediator } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { IDriverCtx } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapeDispatchArgs.js';
import runPrime from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapePrime.js';
import type { IApiDirectScrapeShape } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

const PRIME_URL = 'https://web.example.co.il/transactions';

/** Records navigateTo URLs + idle-wait budgets for assertions. */
interface INavSpy {
  readonly urls: string[];
  readonly idleWaits: number[];
}

/**
 * Build the navigateTo spy recording each requested URL.
 * @param spy - Capture ledger.
 * @returns A navigateTo returning a success Procedure.
 */
function makeNavigateTo(spy: INavSpy): (url: string) => Promise<Procedure<void>> {
  return (url: string): Promise<Procedure<void>> => {
    spy.urls.push(url);
    const ok = succeed(undefined);
    return Promise.resolve(ok);
  };
}

/**
 * Build the waitForNetworkIdle spy recording each settle budget.
 * @param spy - Capture ledger.
 * @returns A waitForNetworkIdle returning a success Procedure.
 */
function makeWaitIdle(spy: INavSpy): (ms?: number) => Promise<Procedure<void>> {
  return (ms?: number): Promise<Procedure<void>> => {
    const budget = ms ?? -1;
    spy.idleWaits.push(budget);
    const ok = succeed(undefined);
    return Promise.resolve(ok);
  };
}

/**
 * Fake IActionMediator exposing only navigateTo + waitForNetworkIdle.
 * @param spy - Capture ledger the fakes write to.
 * @returns Cast action mediator.
 */
function fakeExecutor(spy: INavSpy): IActionMediator {
  const navigateTo = makeNavigateTo(spy);
  const waitForNetworkIdle = makeWaitIdle(spy);
  const stub = { navigateTo, waitForNetworkIdle };
  return stub as unknown as IActionMediator;
}

/**
 * Assemble a driver context around an executor Option + shape.
 * @param executor - Executor Option (some/none).
 * @param shape - Shape carrying the optional prime.
 * @returns Cast driver context.
 */
function driverCtx(
  executor: IActionContext['executor'],
  shape: Partial<IApiDirectScrapeShape<unknown, unknown>>,
): IDriverCtx<unknown, unknown> {
  const ctx = { executor } as unknown as IActionContext;
  const driver = { shape, bus: {}, ctx };
  return driver as unknown as IDriverCtx<unknown, unknown>;
}

/**
 * Static prime route for the primed-shape fixture.
 * @returns The fixed prime URL.
 */
function primeRoute(): string {
  return PRIME_URL;
}

/** Shape declaring a static prime route. */
const PRIMED_SHAPE: Partial<IApiDirectScrapeShape<unknown, unknown>> = {
  prime: { navUrl: primeRoute },
};

describe('ApiDirectScrape runPrime', () => {
  it('navigates the executor to the prime route then settles', async () => {
    const spy: INavSpy = { urls: [], idleWaits: [] };
    const executor = fakeExecutor(spy);
    const executorOpt = some(executor);
    const ctx = driverCtx(executorOpt, PRIMED_SHAPE);
    await runPrime(ctx);
    expect(spy.urls).toEqual([PRIME_URL]);
    expect(spy.idleWaits.length).toBe(1);
  });

  it('no-ops when the shape declares no prime', async () => {
    const spy: INavSpy = { urls: [], idleWaits: [] };
    const executor = fakeExecutor(spy);
    const executorOpt = some(executor);
    const ctx = driverCtx(executorOpt, {});
    await runPrime(ctx);
    expect(spy.urls).toEqual([]);
    expect(spy.idleWaits).toEqual([]);
  });

  it('no-ops when no executor is bound (headless bank)', async () => {
    const spy: INavSpy = { urls: [], idleWaits: [] };
    const executorOpt = none();
    const ctx = driverCtx(executorOpt, PRIMED_SHAPE);
    await runPrime(ctx);
    expect(spy.urls).toEqual([]);
  });
});
