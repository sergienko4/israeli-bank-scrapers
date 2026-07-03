/**
 * BIND-API-MEDIATOR client-version prime unit tests — proves
 * `primeClientVersion` stashes the discovered SPA build version on the mediator
 * session-context for banks that declare `clientVersionParam`, merges into the
 * existing context, and is a no-op when the param is absent or nothing is found.
 */

import { jest } from '@jest/globals';
import type { Page } from 'playwright-core';

import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.types.js';
import { primeClientVersion } from '../../../../../Scrapers/Pipeline/Phases/BindApiMediator/BindApiMediatorClientVersion.js';

/** Local mirror of the registry bank-config shape (import is DI-restricted). */
interface ITestBankConfig {
  readonly urls: { readonly base: string };
  readonly balanceKind: 'account' | 'card-cycle';
  readonly authStrategyKind: 'token' | 'session-cookie' | 'api-direct';
  readonly clientVersionParam?: string;
}

/**
 * Build a minimal bank config, optionally declaring `clientVersionParam`.
 * @param clientVersionParam - Query key to discover, or undefined to opt out.
 * @returns Registry-shaped config literal.
 */
function makeConfig(clientVersionParam?: string): ITestBankConfig {
  return {
    urls: { base: 'https://www.example.co.il/' },
    balanceKind: 'card-cycle',
    authStrategyKind: 'session-cookie',
    clientVersionParam,
  };
}

/**
 * Build a mock page whose resource-scan `evaluate` returns `found`.
 * @param found - Canned discovered version (or '' for no match).
 * @returns Mock Playwright page.
 */
function makePage(found: string): Page {
  return {
    /**
     * evaluate — returns the canned discovered version.
     * @returns Resolved version string.
     */
    evaluate: (): Promise<string> => Promise.resolve(found),
  } as unknown as Page;
}

/**
 * Build a mediator spy exposing `getSessionContext` + `setSessionContext`.
 * @param existing - Pre-existing session-context bundle.
 * @returns Mediator with jest-mocked session-context accessors.
 */
function makeMediator(existing: Readonly<Record<string, unknown>>): IApiMediator {
  return {
    getSessionContext: jest.fn((): Readonly<Record<string, unknown>> => existing),
    setSessionContext: jest.fn((): boolean => true),
  } as unknown as IApiMediator;
}

describe('BIND-API-MEDIATOR client-version prime — primeClientVersion', () => {
  it('BIND-VER-1 stashes the discovered version for opted-in banks', async () => {
    const page = makePage('V4.216-RC.4.116');
    const mediator = makeMediator({});
    const config = makeConfig('v');
    const wasStashed = await primeClientVersion(config, page, mediator);
    expect(wasStashed).toBe(true);
    expect(mediator.setSessionContext).toHaveBeenCalledWith({ clientVersion: 'V4.216-RC.4.116' });
  });

  it('BIND-VER-2 merges the version into the existing context', async () => {
    const page = makePage('V4.216-RC.4.116');
    const mediator = makeMediator({ token: 'jwt-abc' });
    const config = makeConfig('v');
    await primeClientVersion(config, page, mediator);
    expect(mediator.setSessionContext).toHaveBeenCalledWith({
      token: 'jwt-abc',
      clientVersion: 'V4.216-RC.4.116',
    });
  });

  it('BIND-VER-3 is a no-op when the param is not declared', async () => {
    const page = makePage('V4.216-RC.4.116');
    const mediator = makeMediator({});
    const config = makeConfig();
    const wasStashed = await primeClientVersion(config, page, mediator);
    expect(wasStashed).toBe(false);
    expect(mediator.setSessionContext).not.toHaveBeenCalled();
  });

  it('BIND-VER-4 skips when no resource carries the version', async () => {
    const page = makePage('');
    const mediator = makeMediator({});
    const config = makeConfig('v');
    const wasStashed = await primeClientVersion(config, page, mediator);
    expect(wasStashed).toBe(false);
    expect(mediator.setSessionContext).not.toHaveBeenCalled();
  });
});
