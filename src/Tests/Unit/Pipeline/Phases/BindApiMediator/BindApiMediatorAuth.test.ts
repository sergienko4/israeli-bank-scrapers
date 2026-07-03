/**
 * BIND-API-MEDIATOR auth-prime unit tests — proves `primeTokenAuth` installs
 * the post-login token verbatim for `'token'` banks, is a no-op for
 * `'session-cookie'` banks, and skips installation when no token is present.
 */

import { jest } from '@jest/globals';
import type { Frame, Page } from 'playwright-core';

import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.types.js';
import { primeTokenAuth } from '../../../../../Scrapers/Pipeline/Phases/BindApiMediator/BindApiMediatorAuth.js';

/** Local mirror of the registry auth-strategy union (import is DI-restricted). */
type AuthKind = 'token' | 'session-cookie' | 'api-direct';

/** Local mirror of the registry bank-config shape (import is DI-restricted). */
interface ITestBankConfig {
  readonly urls: { readonly base: string };
  readonly balanceKind: 'account' | 'card-cycle';
  readonly authStrategyKind: AuthKind;
}

/**
 * Build a minimal bank config with the given auth strategy.
 * @param kind - Auth strategy under test.
 * @returns Registry-shaped config literal.
 */
function makeConfig(kind: AuthKind): ITestBankConfig {
  return {
    urls: { base: 'https://www.example.co.il/' },
    balanceKind: 'card-cycle',
    authStrategyKind: kind,
  };
}

/**
 * Build a mock page whose sessionStorage read returns `raw` and whose frames
 * list is empty (so the poll fallback resolves to false).
 * @param raw - Raw sessionStorage value returned by `evaluate`.
 * @returns Mock Playwright page.
 */
function makePage(raw: string): Page {
  return {
    /**
     * evaluate — returns the canned sessionStorage value.
     * @returns Resolved raw value.
     */
    evaluate: (): Promise<string> => Promise.resolve(raw),
    /**
     * frames — no frames, so the poll tier finds nothing.
     * @returns Empty frames array.
     */
    frames: (): Frame[] => [],
  } as unknown as Page;
}

/**
 * Build a mediator spy exposing a stubbed `setRawAuth`.
 * @returns Mediator with a jest-mocked `setRawAuth`.
 */
function makeMediator(): IApiMediator {
  return {
    setRawAuth: jest.fn((): boolean => true),
  } as unknown as IApiMediator;
}

describe('BIND-API-MEDIATOR auth-prime — primeTokenAuth', () => {
  it('BIND-AUTH-1 installs the prefixed token verbatim for token banks', async () => {
    const page = makePage('{"auth":{"calConnectToken":"jwt-abc-123"}}');
    const mediator = makeMediator();
    const config = makeConfig('token');
    const wasInstalled = await primeTokenAuth(config, page, mediator);
    expect(wasInstalled).toBe(true);
    expect(mediator.setRawAuth).toHaveBeenCalledWith('CALAuthScheme jwt-abc-123');
  });

  it('BIND-AUTH-2 is a no-op for session-cookie banks', async () => {
    const page = makePage('{"auth":{"calConnectToken":"jwt-abc-123"}}');
    const mediator = makeMediator();
    const config = makeConfig('session-cookie');
    const wasInstalled = await primeTokenAuth(config, page, mediator);
    expect(wasInstalled).toBe(false);
    expect(mediator.setRawAuth).not.toHaveBeenCalled();
  });

  it('BIND-AUTH-3 skips install when no token is present', async () => {
    const page = makePage('NONE');
    const mediator = makeMediator();
    const config = makeConfig('token');
    const wasInstalled = await primeTokenAuth(config, page, mediator);
    expect(wasInstalled).toBe(false);
    expect(mediator.setRawAuth).not.toHaveBeenCalled();
  });
});
