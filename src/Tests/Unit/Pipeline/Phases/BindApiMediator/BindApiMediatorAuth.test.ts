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

  it('BIND-AUTH-4 installs a token found in a cross-origin SPA frame', async () => {
    const frame = makeFrame({
      keys: ['authorizationState', 'currentSession'],
      values: ['{"auth":{"token":"fibi-jwt-xyz"}}'],
    });
    const mediator = makeMediator();
    const config = makeConfig('token');
    const page = makeFramePage([frame]);
    const wasInstalled = await primeTokenAuth(config, page, mediator);
    expect(wasInstalled).toBe(true);
    expect(mediator.setRawAuth).toHaveBeenCalledWith('CALAuthScheme fibi-jwt-xyz');
  });
});
