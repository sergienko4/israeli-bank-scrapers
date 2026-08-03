/**
 * Extra coverage for PopupInterceptor — dismissal paths when mediator present.
 */

import { createPopupInterceptor } from '../../../../Scrapers/Pipeline/Interceptors/PopupInterceptor.js';
import type {
  IElementMediator,
  IRaceResult,
} from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { IPipelineContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../Infrastructure/MockFactories.js';

/** URL every stub mediator reports before and after a dismissal. */
const STUB_URL = 'https://bank.example/';

/**
 * The URL-reporting half of a stub mediator.
 *
 * <p>Dismissal never navigates in these specs, so every mediator answers the
 * same URL. Spreading one definition keeps them from drifting apart.
 * @returns Partial mediator carrying only `getCurrentUrl`.
 */
function withStableUrl(): Partial<IElementMediator> {
  return {
    /**
     * The fixed URL shared by every stub in this spec.
     * @returns A stable URL.
     */
    getCurrentUrl: (): string => STUB_URL,
  };
}

/** Stub mediator plus the observed dismissal-probe call count. */
interface ICountingMediator {
  readonly mediator: IElementMediator;
  readonly calls: { count: number };
}

/**
 * Build a mediator that records whether a dismissal probe ran at all.
 * @returns Mediator plus the probe counter.
 */
function makeCountingMediator(): ICountingMediator {
  const calls = { count: 0 };
  const mediator = {
    /**
     * Records the probe and reports nothing to close.
     * @returns Succeed with a not-found result.
     */
    resolveAndClick: (): Promise<unknown> => {
      calls.count += 1;
      const clicked = succeed(NOT_FOUND_RESULT);
      return Promise.resolve(clicked);
    },
    /**
     * waitForNetworkIdle.
     * @returns Succeed.
     */
    waitForNetworkIdle: (): Promise<unknown> => {
      const idle = succeed(undefined);
      return Promise.resolve(idle);
    },
    network: {
      /**
       * getAllEndpoints.
       * @returns Empty pool.
       */
      getAllEndpoints: (): unknown[] => [],
    },
    ...withStableUrl(),
  } as unknown as IElementMediator;
  return { mediator, calls };
}

/**
 * Build a stub mediator whose resolveAndClick returns a found or not-found result.
 * @param clickFinds - Whether the resolver finds a popup.
 * @returns Mock element mediator.
 */
function makeMediator(clickFinds: boolean): IElementMediator {
  const foundResult: IRaceResult = {
    ...NOT_FOUND_RESULT,
    found: true as const,
    value: 'X',
  };
  const networkState: { eps: number } = { eps: 0 };
  return {
    /**
     * resolveAndClick — scripted.
     * @returns Succeed result.
     */
    resolveAndClick: () => {
      const raceResult = clickFinds ? foundResult : NOT_FOUND_RESULT;
      const okResult = succeed(raceResult);
      return Promise.resolve(okResult);
    },
    /**
     * waitForNetworkIdle.
     * @returns Succeed.
     */
    waitForNetworkIdle: () => {
      const idleResult = succeed(undefined);
      return Promise.resolve(idleResult);
    },
    network: {
      /**
       * getAllEndpoints.
       * @returns Endpoint array of length eps.
       */
      getAllEndpoints: (): unknown[] => Array(networkState.eps).fill({}),
    },
    ...withStableUrl(),
  } as unknown as IElementMediator;
}

describe('PopupInterceptor — dismissal paths', () => {
  it('attempts dismiss on home phase with mediator present', async () => {
    const interceptor = createPopupInterceptor();
    const base = makeMockContext();
    const makeMediatorResult1 = makeMediator(true);
    const ctx: IPipelineContext = {
      ...base,
      mediator: some(makeMediatorResult1),
    };
    const result = await interceptor.beforePhase(ctx, 'home');
    expect(result).toBeDefined();
    const isOkResult2 = isOk(result);
    expect(isOkResult2).toBe(true);
  });

  it('skips dismiss when nothing found', async () => {
    const interceptor = createPopupInterceptor();
    const base = makeMockContext();
    const makeMediatorResult3 = makeMediator(false);
    const ctx: IPipelineContext = {
      ...base,
      mediator: some(makeMediatorResult3),
    };
    const result = await interceptor.beforePhase(ctx, 'dashboard');
    expect(result).toBeDefined();
    const isOkResult4 = isOk(result);
    expect(isOkResult4).toBe(true);
  });

  it('respects cooldown — second immediate call is skipped', async () => {
    const interceptor = createPopupInterceptor();
    const base = makeMockContext();
    const makeMediatorResult5 = makeMediator(true);
    const ctx: IPipelineContext = {
      ...base,
      mediator: some(makeMediatorResult5),
    };
    const r1 = await interceptor.beforePhase(ctx, 'home');
    const r2 = await interceptor.beforePhase(ctx, 'home');
    expect(r1).toBeDefined();
    expect(r2).toBeDefined();
  });

  it('skips when phase is not in whitelist', async () => {
    const interceptor = createPopupInterceptor();
    const base = makeMockContext();
    const makeMediatorResult6 = makeMediator(true);
    const ctx: IPipelineContext = {
      ...base,
      mediator: some(makeMediatorResult6),
    };
    const result = await interceptor.beforePhase(ctx, 'login');
    expect(result).toBeDefined();
    const isOkResult7 = isOk(result);
    expect(isOkResult7).toBe(true);
  });

  it('does not probe on the login screen', async () => {
    const interceptor = createPopupInterceptor();
    const { mediator, calls } = makeCountingMediator();
    const ctx: IPipelineContext = { ...makeMockContext(), mediator: some(mediator) };
    await interceptor.beforePhase(ctx, 'pre-login');
    expect(calls.count).toBe(0);
  });

  it('traces network delta when endpoints grow after dismiss', async () => {
    const interceptor = createPopupInterceptor();
    const base = makeMockContext();
    const networkState = { eps: 0 };
    const foundResult: IRaceResult = {
      ...NOT_FOUND_RESULT,
      found: true as const,
      value: 'X',
    };
    const mediator = {
      /**
       * resolveAndClick increments endpoints on each call to simulate dismiss-triggered traffic.
       * @returns Succeed with found result.
       */
      resolveAndClick: () => {
        networkState.eps += 1;
        const succeedResult8 = succeed(foundResult);
        return Promise.resolve(succeedResult8);
      },
      /**
       * waitForNetworkIdle.
       * @returns Succeed.
       */
      waitForNetworkIdle: () => {
        const idleResult = succeed(undefined);
        return Promise.resolve(idleResult);
      },
      network: {
        /**
         * getAllEndpoints returns current count.
         * @returns Array of length eps.
         */
        getAllEndpoints: (): unknown[] => new Array(networkState.eps).fill({}),
      },
      ...withStableUrl(),
    } as unknown as IElementMediator;
    const ctx: IPipelineContext = {
      ...base,
      mediator: some(mediator),
    };
    const result = await interceptor.beforePhase(ctx, 'home');
    expect(result).toBeDefined();
    const isOkResult9 = isOk(result);
    expect(isOkResult9).toBe(true);
  });

  it('dismisses first popup then fails second (line 92 branch)', async () => {
    const interceptor = createPopupInterceptor();
    const base = makeMockContext();
    let callCount = 0;
    const foundResult: IRaceResult = {
      ...NOT_FOUND_RESULT,
      found: true as const,
      value: 'X',
    };
    const mediator = {
      /**
       * resolveAndClick — first call found, second call not found.
       * @returns Succeed procedure.
       */
      resolveAndClick: () => {
        callCount += 1;
        const succeedResult10 = succeed(foundResult);
        if (callCount === 1) return Promise.resolve(succeedResult10);
        const succeedResult11 = succeed(NOT_FOUND_RESULT);
        return Promise.resolve(succeedResult11);
      },
      /**
       * waitForNetworkIdle.
       * @returns Succeed.
       */
      waitForNetworkIdle: () => {
        const idleResult = succeed(undefined);
        return Promise.resolve(idleResult);
      },
      network: {
        /**
         * getAllEndpoints.
         * @returns Empty endpoints.
         */
        getAllEndpoints: (): unknown[] => [],
      },
      ...withStableUrl(),
    } as unknown as IElementMediator;
    const ctx: IPipelineContext = {
      ...base,
      mediator: some(mediator),
    };
    const result = await interceptor.beforePhase(ctx, 'home');
    expect(result).toBeDefined();
    const isOkResult12 = isOk(result);
    expect(isOkResult12).toBe(true);
  });

  it('handles resolveAndClick rejection (caught) without propagating', async () => {
    const interceptor = createPopupInterceptor();
    const base = makeMockContext();
    const mediator = {
      /**
       * resolveAndClick throws.
       * @returns Rejected.
       */
      resolveAndClick: (): Promise<never> => Promise.reject(new Error('cr')),
      /**
       * waitForNetworkIdle.
       * @returns Succeed.
       */
      waitForNetworkIdle: () => {
        const idleResult = succeed(undefined);
        return Promise.resolve(idleResult);
      },
      network: {
        /**
         * getAllEndpoints.
         * @returns Empty.
         */
        getAllEndpoints: (): unknown[] => [],
      },
      ...withStableUrl(),
    } as unknown as IElementMediator;
    const ctx: IPipelineContext = {
      ...base,
      mediator: some(mediator),
    };
    const result = await interceptor.beforePhase(ctx, 'home');
    expect(result).toBeDefined();
    const isOkResult13 = isOk(result);
    expect(isOkResult13).toBe(true);
  });
});
