/**
 * BIND-API-MEDIATOR auth-prime unit tests — proves `primeTokenAuth` resolves the
 * post-login Authorization via the 5-tier AuthDiscovery orchestrator: installs a
 * token from a login response body (Tier 2 — the VisaCal path) or from
 * page/frame sessionStorage (Tier 3) for `'token'` banks, is a no-op for
 * `'session-cookie'` banks, and skips installation when no tier yields a token.
 * Also proves the config-driven family-scoped header sniff (FIBI `appsng`): it
 * installs the family Bearer verbatim, takes priority over the storage tier,
 * skips the Bearer-less OAuth code-exchange, and falls back to the 5-tier on miss.
 */

import { jest } from '@jest/globals';
import type { Frame, Page } from 'playwright-core';

import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.types.js';
import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/Types/Endpoint.js';
import {
  buildDiscoveredHeaderBag,
  primeTokenAuth,
} from '../../../../../Scrapers/Pipeline/Phases/BindApiMediator/BindApiMediatorAuth.js';

/** Local mirror of the registry auth-strategy union (import is DI-restricted). */
type AuthKind = 'token' | 'session-cookie' | 'api-direct';

/** Local mirror of the registry bank-config shape (import is DI-restricted). */
interface ITestBankConfig {
  readonly urls: { readonly base: string };
  readonly balanceKind: 'account' | 'card-cycle';
  readonly authStrategyKind: AuthKind;
  readonly installDiscoveredHeaders?: boolean;
  readonly authHeaderUrlMatch?: string;
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
 * Build a `'token'` bank config with the discovered-header opt-in flag set.
 * @param optIn - Whether the bank opts into the discovered-header bag.
 * @returns Registry-shaped config literal.
 */
function makeHeaderConfig(optIn: boolean): ITestBankConfig {
  const base = makeConfig('token');
  return { ...base, installDiscoveredHeaders: optIn };
}

/**
 * Build a `'token'` bank config declaring the family-scoped auth-header sniff.
 * @param urlMatch - Endpoint-family substring the sniff scopes to.
 * @returns Registry-shaped config literal.
 */
function makeSniffConfig(urlMatch: string): ITestBankConfig {
  const base = makeConfig('token');
  return { ...base, authHeaderUrlMatch: urlMatch };
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

/** Script for a mock child frame's sessionStorage. */
interface IFrameScript {
  /** All sessionStorage key names in the frame (diagnostic dump + 3b). */
  readonly keys: readonly string[];
  /** JSON-shaped values across all keys (all-keys scan input, 3c). */
  readonly values: readonly string[];
}

/**
 * Dispatch a scripted frame read by inspecting the evaluated function source:
 * key-list dump, well-known-key read ('NONE'), or all-values scan.
 * @param script - Frame storage script.
 * @param fn - Browser-side function passed to evaluate.
 * @returns Scripted read result.
 */
function frameRead(script: IFrameScript, fn: unknown): Promise<unknown> {
  const source = String(fn);
  if (source.includes('Object.keys') && !source.includes('filter')) {
    return Promise.resolve(script.keys.join(', ') || 'EMPTY');
  }
  if (source.includes('filter')) return Promise.resolve(script.values);
  return Promise.resolve('NONE');
}

/**
 * Build a mock Frame serving the Tier 3b/3c reads from the script.
 * @param script - Frame storage script.
 * @returns Mock Playwright frame.
 */
function makeFrame(script: IFrameScript): Frame {
  return {
    /**
     * evaluate — scripted per the browser-side function source.
     * @param fn - Browser-side function.
     * @returns Scripted result.
     */
    evaluate: (fn: unknown): Promise<unknown> => frameRead(script, fn),
    /**
     * url — the cross-origin SPA frame origin.
     * @returns Frame URL.
     */
    url: (): string => 'https://online.fibi.co.il/appsng/',
  } as unknown as Frame;
}

/**
 * Build a mock page whose main sessionStorage is empty but which exposes the
 * given child frames (for the all-frames storage scan).
 * @param frames - Child frames to expose.
 * @returns Mock Playwright page.
 */
function makeFramePage(frames: readonly Frame[]): Page {
  return {
    /**
     * evaluate — main page holds no auth storage.
     * @returns Resolved 'NONE'.
     */
    evaluate: (): Promise<string> => Promise.resolve('NONE'),
    /**
     * frames — the scripted child frames.
     * @returns Frames array.
     */
    frames: (): readonly Frame[] => frames,
  } as unknown as Page;
}

/**
 * Build a captured auth endpoint carrying the given response body — the Tier 2
 * source. Fields the response tier ignores are cast away.
 * @param url - Captured request URL (matched against WK auth patterns).
 * @param responseBody - Parsed response body the pool capture exposes.
 * @returns Minimal discovered-endpoint literal.
 */
function makeAuthEndpoint(url: string, responseBody: unknown): IDiscoveredEndpoint {
  return { url, responseBody, requestHeaders: {} } as unknown as IDiscoveredEndpoint;
}

/**
 * Build a captured endpoint carrying the given request headers — the Tier 1 /
 * family-scoped-sniff source. The response body is irrelevant here.
 * @param url - Captured request URL (matched against `authHeaderUrlMatch`).
 * @param requestHeaders - Request headers the pool capture exposes.
 * @returns Minimal discovered-endpoint literal.
 */
function makeHeaderEndpoint(
  url: string,
  requestHeaders: Record<string, string>,
): IDiscoveredEndpoint {
  return { url, responseBody: null, requestHeaders } as unknown as IDiscoveredEndpoint;
}

/** Empty login pool — the storage-tier tests read only the page. */
const NO_POOL: readonly IDiscoveredEndpoint[] = [];

describe('BIND-API-MEDIATOR auth-prime — storage tiers', () => {
  it('BIND-AUTH-1 installs the prefixed token verbatim for token banks', async () => {
    const page = makePage('{"auth":{"calConnectToken":"jwt-abc-123"}}');
    const mediator = makeMediator();
    const config = makeConfig('token');
    const wasInstalled = await primeTokenAuth(config, { pool: NO_POOL, page }, mediator);
    expect(wasInstalled).toBe(true);
    expect(mediator.setRawAuth).toHaveBeenCalledWith('CALAuthScheme jwt-abc-123');
  });

  it('BIND-AUTH-2 is a no-op for session-cookie banks', async () => {
    const page = makePage('{"auth":{"calConnectToken":"jwt-abc-123"}}');
    const mediator = makeMediator();
    const config = makeConfig('session-cookie');
    const wasInstalled = await primeTokenAuth(config, { pool: NO_POOL, page }, mediator);
    expect(wasInstalled).toBe(false);
    expect(mediator.setRawAuth).not.toHaveBeenCalled();
  });

  it('BIND-AUTH-3 skips install when no token is present', async () => {
    const page = makePage('NONE');
    const mediator = makeMediator();
    const config = makeConfig('token');
    const wasInstalled = await primeTokenAuth(config, { pool: NO_POOL, page }, mediator);
    expect(wasInstalled).toBe(false);
    expect(mediator.setRawAuth).not.toHaveBeenCalled();
  });

  it('BIND-AUTH-4 installs a token found in a cross-origin SPA frame', async () => {
    const frame = makeFrame({
      keys: ['authorizationState', 'currentSession'],
      values: ['{"auth":{"token":"fibi-jwt-xyz"}}'],
    });
    const mediator = makeMediator();
    const config = makeConfig('token');
    const page = makeFramePage([frame]);
    const wasInstalled = await primeTokenAuth(config, { pool: NO_POOL, page }, mediator);
    expect(wasInstalled).toBe(true);
    expect(mediator.setRawAuth).toHaveBeenCalledWith('CALAuthScheme fibi-jwt-xyz');
  });
});

describe('BIND-API-MEDIATOR auth-prime — response-body tier (Tier 2)', () => {
  const loginUrl = 'https://connect.example.co.il/col-rest/calconnect/authentication/login';

  it('BIND-AUTH-5 installs a token from a login response body for token banks', async () => {
    const pool = [makeAuthEndpoint(loginUrl, { token: 'cal-jwt-90210', hash: null })];
    const mediator = makeMediator();
    const config = makeConfig('token');
    const wasInstalled = await primeTokenAuth(config, { pool, page: makePage('NONE') }, mediator);
    expect(wasInstalled).toBe(true);
    expect(mediator.setRawAuth).toHaveBeenCalledWith('CALAuthScheme cal-jwt-90210');
  });

  it('BIND-AUTH-6 is a no-op for session-cookie banks despite a response token', async () => {
    const pool = [makeAuthEndpoint(loginUrl, { token: 'cal-jwt-90210' })];
    const mediator = makeMediator();
    const config = makeConfig('session-cookie');
    const wasInstalled = await primeTokenAuth(config, { pool, page: makePage('NONE') }, mediator);
    expect(wasInstalled).toBe(false);
    expect(mediator.setRawAuth).not.toHaveBeenCalled();
  });

  it('BIND-AUTH-7 skips install when no tier yields a token', async () => {
    const pool = [makeAuthEndpoint('https://cdn.example.co.il/assets/app.js', { nope: 1 })];
    const mediator = makeMediator();
    const config = makeConfig('token');
    const wasInstalled = await primeTokenAuth(config, { pool, page: makePage('NONE') }, mediator);
    expect(wasInstalled).toBe(false);
    expect(mediator.setRawAuth).not.toHaveBeenCalled();
  });
});

describe('BIND-API-MEDIATOR auth-prime — family-scoped header sniff (appsng)', () => {
  const menusUrl = 'https://online.fibi.co.il/appsng/bff-portal-shell/api/v1/menu/menus';
  const authorizeUrl =
    'https://online.fibi.co.il/appsng/bff-portal-shell/api/v1/autorization/authorize?code=AAM2';
  const summaryUrl =
    'https://online.fibi.co.il/appsng/bff-portal-accountsummary/api/v1/accountSummary';

  it('BIND-SNIFF-1 installs the family-scoped Bearer verbatim for token banks', async () => {
    const pool = [makeHeaderEndpoint(menusUrl, { authorization: 'Bearer fibi-appsng-jwt' })];
    const mediator = makeMediator();
    const config = makeSniffConfig('appsng/bff-');
    const wasInstalled = await primeTokenAuth(config, { pool, page: makePage('NONE') }, mediator);
    expect(wasInstalled).toBe(true);
    expect(mediator.setRawAuth).toHaveBeenCalledWith('Bearer fibi-appsng-jwt');
  });

  it('BIND-SNIFF-2 takes priority over a storage-tier token', async () => {
    const pool = [makeHeaderEndpoint(menusUrl, { authorization: 'Bearer fibi-appsng-jwt' })];
    const mediator = makeMediator();
    const config = makeSniffConfig('appsng/bff-');
    const page = makePage('{"auth":{"calConnectToken":"storage-should-not-win"}}');
    await primeTokenAuth(config, { pool, page }, mediator);
    expect(mediator.setRawAuth).toHaveBeenCalledWith('Bearer fibi-appsng-jwt');
  });

  it('BIND-SNIFF-3 skips the Bearer-less OAuth code-exchange', async () => {
    const pool = [
      makeHeaderEndpoint(authorizeUrl, {}),
      makeHeaderEndpoint(summaryUrl, { authorization: 'Bearer fibi-appsng-jwt' }),
    ];
    const mediator = makeMediator();
    const config = makeSniffConfig('appsng/bff-');
    const wasInstalled = await primeTokenAuth(config, { pool, page: makePage('NONE') }, mediator);
    expect(wasInstalled).toBe(true);
    expect(mediator.setRawAuth).toHaveBeenCalledWith('Bearer fibi-appsng-jwt');
  });

  it('BIND-SNIFF-4 falls back to the 5-tier when no endpoint matches', async () => {
    const pool = [makeHeaderEndpoint('https://cdn.example.co.il/assets/app.js', {})];
    const mediator = makeMediator();
    const config = makeSniffConfig('appsng/bff-');
    const page = makePage('{"auth":{"calConnectToken":"fallback-token"}}');
    const wasInstalled = await primeTokenAuth(config, { pool, page }, mediator);
    expect(wasInstalled).toBe(true);
    expect(mediator.setRawAuth).toHaveBeenCalledWith('CALAuthScheme fallback-token');
  });
});

describe('BIND-API-MEDIATOR discovered-header bag — installDiscoveredHeaders gate', () => {
  it('BIND-BAG-1 folds the discovered token into an opted-in bag as Authorization', () => {
    const config = makeHeaderConfig(true);
    const bag = buildDiscoveredHeaderBag(config, NO_POOL, 'CALAuthScheme jwt-bag-1');
    expect(bag).toEqual({ authorization: 'CALAuthScheme jwt-bag-1' });
  });

  it('BIND-BAG-2 returns an empty bag for a bank that does not opt in', () => {
    const config = makeHeaderConfig(false);
    const bag = buildDiscoveredHeaderBag(config, NO_POOL, 'CALAuthScheme jwt-bag-2');
    expect(bag).toEqual({});
  });

  it('BIND-BAG-3 returns an empty bag when opted in but no token was discovered', () => {
    const config = makeHeaderConfig(true);
    const bag = buildDiscoveredHeaderBag(config, NO_POOL, false);
    expect(bag).toEqual({});
  });
});
