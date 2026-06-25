/**
 * Unit tests for LoginCookieAudit — Mission 1+ replacement for the
 * deleted `Mediator/Auth/LoginSignalProbe.ts`. The handler is the
 * sole LOGIN.FINAL implementation: pure cookie-count audit, zero
 * dashboard-zone or auth-token-discovery surface.
 */

import type {
  ICookieSnapshot,
  IElementMediator,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { executeLoginSignal } from '../../../../../Scrapers/Pipeline/Mediator/Login/LoginCookieAudit.js';
import type {
  ILoginState,
  IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { SUCCEED_VOID } from '../../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

/**
 * Build a minimal mediator stub returning the supplied cookies.
 *
 * @param cookies - Cookie snapshots to return.
 * @returns Mediator stub.
 */
function makeCookieMediator(cookies: readonly ICookieSnapshot[]): IElementMediator {
  return {
    /**
     * Network-idle stub — resolves immediately with success.
     * @returns Resolved success procedure.
     */
    waitForNetworkIdle: () => SUCCEED_VOID,
    /**
     * Returns the supplied cookie snapshots.
     * @returns Cookies.
     */
    getCookies: (): Promise<readonly ICookieSnapshot[]> => Promise.resolve(cookies),
  } as unknown as IElementMediator;
}

const FAKE_COOKIE: ICookieSnapshot = {
  name: 'JSESSIONID',
  value: 'fake-session-redacted',
  domain: 'example.bank',
  path: '/',
  expires: -1,
  httpOnly: true,
  secure: true,
  sameSite: 'None',
} as ICookieSnapshot;

/**
 * Build a context with a fake login state attached.
 *
 * @param mediator - Optional mediator override.
 * @returns Pipeline context.
 */
function ctxWithLogin(mediator?: IElementMediator): IPipelineContext {
  const base = makeMockContext();
  return {
    ...base,
    login: { has: true, value: { cleanups: [] } as unknown as ILoginState },
    mediator: mediator ? { has: true, value: mediator } : { has: false },
  };
}

describe('executeLoginSignal — Mission 1+ cookie-only audit', () => {
  it('fails when login state is absent', async () => {
    const ctx = makeMockContext();
    const result = await executeLoginSignal(ctx);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('LOGIN final: no login state');
    }
  });

  it('passes through when no mediator is attached', async () => {
    const ctx = ctxWithLogin();
    const result = await executeLoginSignal(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('succeeds and stamps cookie count when at least one cookie is present', async () => {
    const mediator = makeCookieMediator([FAKE_COOKIE, FAKE_COOKIE]);
    const ctx = ctxWithLogin(mediator);
    const result = await executeLoginSignal(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    if (isOk(result)) {
      expect(result.value.diagnostics.lastAction).toContain('login-signal (cookies=2)');
    }
  });

  it('fails AUTH_SESSION_INVALID when cookies are empty', async () => {
    const mediator = makeCookieMediator([]);
    const ctx = ctxWithLogin(mediator);
    const result = await executeLoginSignal(ctx);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('AUTH_SESSION_INVALID');
      expect(result.errorMessage).toContain('0 cookies');
    }
  });

  it('catches a waitForNetworkIdle rejection and proceeds to the cookie audit', async () => {
    const mediator = {
      /**
       * Network-idle stub — rejects to exercise the inline catch.
       * @returns Rejection.
       */
      waitForNetworkIdle: (): Promise<never> => Promise.reject(new Error('network-idle-throw')),
      /**
       * Returns one cookie so the audit succeeds.
       * @returns Cookies.
       */
      getCookies: (): Promise<readonly ICookieSnapshot[]> => Promise.resolve([FAKE_COOKIE]),
    } as unknown as IElementMediator;
    const ctx = ctxWithLogin(mediator);
    const result = await executeLoginSignal(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('survives a getCookies throw and treats missing cookies as 0 (fails loud)', async () => {
    const mediator = {
      /**
       * Network-idle stub — resolves immediately.
       * @returns Resolved success.
       */
      waitForNetworkIdle: () => SUCCEED_VOID,
      /**
       * Always rejects.
       * @returns Rejection.
       */
      getCookies: (): Promise<readonly ICookieSnapshot[]> =>
        Promise.reject(new Error('cookie-read-failure')),
    } as unknown as IElementMediator;
    const ctx = ctxWithLogin(mediator);
    const promise = executeLoginSignal(ctx);
    await expect(promise).rejects.toThrow('cookie-read-failure');
  });
});
