/**
 * Unit tests for LoginSignalProbe — cookie audit + auth token + proxy detection.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import executeLoginSignal from '../../../../../Scrapers/Pipeline/Mediator/Auth/LoginSignalProbe.js';
import type { IElementMediator } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

/** Shape of a cookie entry returned by the mock mediator. */
interface IMockCookie {
  readonly name: string;
  readonly domain: string;
  readonly value: string;
}

/** Options for building the mock mediator used by LoginSignal. */
interface IMockMediatorOpts {
  readonly cookies: readonly IMockCookie[];
  readonly auth: string | false;
  readonly proxy: string | false;
}

/**
 * Build a mock IElementMediator with the fields LoginSignal uses.
 * @param opts - Mock opts.
 * @returns Mock mediator.
 */
function makeMediator(opts: IMockMediatorOpts): IElementMediator {
  return {
    /**
     * waitForNetworkIdle.
     * @returns Resolved succeed.
     */
    waitForNetworkIdle: (): Promise<{ success: true; value: boolean }> =>
      Promise.resolve({ success: true, value: true }),
    /**
     * getCookies.
     * @returns Cookie array.
     */
    getCookies: (): Promise<readonly IMockCookie[]> => Promise.resolve(opts.cookies),
    /**
     * getCurrentUrl.
     * @returns Mock URL.
     */
    getCurrentUrl: (): string => 'https://bank.co.il/dashboard',
    /**
     * resolveVisible stub — returns not-found.
     * @returns Mock NOT_FOUND-like shape.
     */
    resolveVisible: (): Promise<{
      found: false;
      locator: false;
      candidate: false;
      context: false;
      index: -1;
      value: '';
    }> =>
      Promise.resolve({
        found: false,
        locator: false,
        candidate: false,
        context: false,
        index: -1,
        value: '',
      }),
    network: {
      /**
       * discoverAuthToken.
       * @returns Mock token.
       */
      discoverAuthToken: (): Promise<string | false> => Promise.resolve(opts.auth),
      /**
       * discoverProxyEndpoint.
       * @returns Mock proxy.
       */
      discoverProxyEndpoint: (): string | false => opts.proxy,
      /**
       * waitForTraffic — fast no-match so LOGIN.FINAL flows past the
       * shared discovery handler immediately. Tests that need a
       * specific match override this in their own stub.
       * @returns Resolved false.
       */
      waitForTraffic: (): Promise<false> => Promise.resolve(false),
      /**
       * Empty pre-nav so PreNavReadiness skips (gate-not-yet-on path).
       * Tests that exercise the readiness FAIL path supply their own
       * mock with non-empty captures.
       * @returns Empty array.
       */
      getPreNavCaptures: (): readonly [] => [],
      /**
       * Empty endpoint pool so PreNavReadiness sees zero captures →
       * skip enforcement.
       * @returns Empty array.
       */
      getAllEndpoints: (): readonly [] => [],
    },
  } as unknown as IElementMediator;
}

describe('executeLoginSignal', () => {
  it('fails when login state not present', async () => {
    const ctx = makeMockContext({
      login: { has: false } as IPipelineContext['login'],
    });
    const result = await executeLoginSignal(ctx);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorType).toBe(ScraperErrorTypes.Generic);
  });

  it('succeeds without mediator (no-op pass-through)', async () => {
    const ctx = makeMockContext({
      login: { has: true, value: {} } as IPipelineContext['login'],
      mediator: { has: false } as IPipelineContext['mediator'],
    });
    const result = await executeLoginSignal(ctx);
    expect(result.success).toBe(true);
  });

  it('fails when cookie count is 0', async () => {
    const ctx = makeMockContext({
      login: { has: true, value: {} } as IPipelineContext['login'],
      mediator: {
        has: true,
        value: makeMediator({ cookies: [], auth: false, proxy: false }),
      } as IPipelineContext['mediator'],
    });
    const result = await executeLoginSignal(ctx);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('AUTH_SESSION_INVALID');
  });

  it('succeeds with cookies present and records DIRECT strategy', async () => {
    const cookies = [{ name: 'SID', domain: 'bank.co.il', value: 'abc' }];
    const ctx = makeMockContext({
      login: { has: true, value: {} } as IPipelineContext['login'],
      mediator: {
        has: true,
        value: makeMediator({ cookies, auth: false, proxy: false }),
      } as IPipelineContext['mediator'],
    });
    const result = await executeLoginSignal(ctx);
    expect(result.success).toBe(true);
  });

  it('swallows waitForNetworkIdle rejection during cookie audit (catch branch)', async () => {
    const cookies = [{ name: 'SID', domain: 'bank.co.il', value: 'abc' }];
    const mediator = makeMediator({ cookies, auth: false, proxy: false });
    // Override waitForNetworkIdle to reject — exercises the .catch branch
    const withReject = {
      ...mediator,
      /**
       * waitForNetworkIdle that rejects.
       * @returns Rejected promise.
       */
      waitForNetworkIdle: (): Promise<never> => Promise.reject(new Error('idle-timeout')),
    } as unknown as IElementMediator;
    const ctx = makeMockContext({
      login: { has: true, value: {} } as IPipelineContext['login'],
      mediator: { has: true, value: withReject } as IPipelineContext['mediator'],
    });
    const result = await executeLoginSignal(ctx);
    // Cookie count > 0 → succeeds even though waitForNetworkIdle rejected
    expect(result.success).toBe(true);
  });

  it('fails when pre-nav captures lack an account container (readiness fail-loud)', async () => {
    const cookies = [{ name: 'SID', domain: 'bank.co.il', value: 'abc' }];
    const baseMediator = makeMediator({ cookies, auth: false, proxy: false });
    // Override network to expose a non-empty pool with NO account container —
    // this exercises the readiness fail path inside executeLoginSignal.
    const mediator = {
      ...baseMediator,
      network: {
        ...(baseMediator.network as object),
        /**
         * Non-empty pre-nav with body that doesn't expose an account
         * container — readiness check must fail loud.
         * @returns Single capture with unrelated body.
         */
        getPreNavCaptures: (): readonly { responseBody: unknown }[] => [
          { responseBody: { unrelated: true } },
        ],
        /**
         * Same single endpoint — non-zero count flips
         * `shouldSkipPreNavCheck` off so the check actually runs.
         * @returns Single endpoint.
         */
        getAllEndpoints: (): readonly object[] => [{ responseBody: { unrelated: true } }],
      },
    } as unknown as IElementMediator;
    const ctx = makeMockContext({
      login: { has: true, value: {} } as IPipelineContext['login'],
      mediator: { has: true, value: mediator } as IPipelineContext['mediator'],
      accountDiscoveryAt: 'login',
    });
    const result = await executeLoginSignal(ctx);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('LOGIN');
      expect(result.errorMessage).toContain('account/cards container');
    }
  });

  it('succeeds with proxy-based strategy when proxy discovered', async () => {
    const cookies = [{ name: 'SID', domain: 'bank.co.il', value: 'abc' }];
    const ctx = makeMockContext({
      login: { has: true, value: {} } as IPipelineContext['login'],
      mediator: {
        has: true,
        value: makeMediator({
          cookies,
          auth: 'Bearer xyz',
          proxy: 'https://proxy.bank.co.il/api',
        }),
      } as IPipelineContext['mediator'],
    });
    const result = await executeLoginSignal(ctx);
    expect(result.success).toBe(true);
  });
});
