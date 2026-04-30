/**
 * Unit tests for DashboardProbe — change-password + auth extraction via mediator.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import checkChangePassword, {
  extractAuthFromContext,
  extractDashboardAuth,
} from '../../../../../Scrapers/Pipeline/Mediator/Dashboard/DashboardProbe.js';
import type {
  IElementMediator,
  IRaceResult,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { ScraperLogger } from '../../../../../Scrapers/Pipeline/Types/Debug.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

/** Overrides for mock mediator. */
interface IMediatorScript {
  readonly visibleResult?: IRaceResult;
  readonly visibleThrows?: boolean;
  readonly authToken?: string | false;
}

/**
 * Build a mock element mediator for DashboardProbe tests.
 * @param script - Mediator script.
 * @returns IElementMediator mock.
 */
function makeMediator(script: IMediatorScript = {}): IElementMediator {
  return {
    /**
     * resolveVisible — returns scripted race result or throws.
     * @returns Scripted behaviour.
     */
    resolveVisible: (): Promise<IRaceResult> => {
      if (script.visibleThrows) return Promise.reject(new Error('boom'));
      return Promise.resolve(script.visibleResult ?? NOT_FOUND_RESULT);
    },
    network: {
      /**
       * discoverAuthToken — returns scripted token.
       * @returns Token or false.
       */
      discoverAuthToken: (): Promise<string | false> => Promise.resolve(script.authToken ?? false),
    },
  } as unknown as IElementMediator;
}

describe('checkChangePassword', () => {
  it('returns false when nothing found', async () => {
    const mediator = makeMediator();
    const result = await checkChangePassword(mediator);
    expect(result).toBe(false);
  });

  it('fails with ChangePassword when probe finds password change prompt', async () => {
    const found: IRaceResult = { ...NOT_FOUND_RESULT, found: true as const };
    const mediator = makeMediator({ visibleResult: found });
    const result = await checkChangePassword(mediator);
    expect(result).not.toBe(false);
    if (result && typeof result === 'object') {
      expect(result.success).toBe(false);
      if (!result.success) expect(result.errorType).toBe(ScraperErrorTypes.ChangePassword);
    }
  });

  it('returns false when resolveVisible throws (defensive catch)', async () => {
    const mediator = makeMediator({ visibleThrows: true });
    const result = await checkChangePassword(mediator);
    expect(result).toBe(false);
  });

  it('returns false when found=false is returned', async () => {
    const mediator = makeMediator({ visibleResult: NOT_FOUND_RESULT });
    const result = await checkChangePassword(mediator);
    expect(result).toBe(false);
  });
});

describe('extractDashboardAuth', () => {
  it('succeeds with false when no token discovered', async () => {
    const mediator = makeMediator({ authToken: false });
    const result = await extractDashboardAuth(mediator);
    const isOkResult1 = isOk(result);
    expect(isOkResult1).toBe(true);
    if (result.success) expect(result.value).toBe(false);
  });

  it('succeeds with token value when discovered', async () => {
    const mediator = makeMediator({ authToken: 'Bearer abc' });
    const result = await extractDashboardAuth(mediator);
    const isOkResult2 = isOk(result);
    expect(isOkResult2).toBe(true);
    if (result.success) expect(result.value).toBe('Bearer abc');
  });

  it('accepts a logger and logs sessionFound boolean', async () => {
    const entries: unknown[] = [];
    const logger = {
      /**
       * Capture debug entry.
       * @param e - Entry.
       * @returns True.
       */
      debug: (e: unknown): boolean => {
        entries.push(e);
        return true;
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      trace: (): boolean => true,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      info: (): boolean => true,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      warn: (): boolean => true,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      error: (): boolean => true,
    } as unknown as ScraperLogger;
    const mediator = makeMediator({ authToken: 'tok' });
    const result = await extractDashboardAuth(mediator, logger);
    const isOkResult3 = isOk(result);
    expect(isOkResult3).toBe(true);
    expect(entries.length).toBeGreaterThan(0);
  });
});

describe('extractAuthFromContext', () => {
  it('returns false when mediator is not present', async () => {
    const ctx = makeMockContext({ mediator: none() });
    const result = await extractAuthFromContext(ctx);
    expect(result).toBe(false);
  });

  it('returns false when mediator.discoverAuthToken returns false', async () => {
    const mediator = makeMediator({ authToken: false });
    const ctx = makeMockContext({ mediator: some(mediator) });
    const result = await extractAuthFromContext(ctx);
    expect(result).toBe(false);
  });

  it('returns the token string when discovered', async () => {
    const mediator = makeMediator({ authToken: 'CALAuthScheme xyz' });
    const ctx = makeMockContext({ mediator: some(mediator) });
    const result = await extractAuthFromContext(ctx);
    expect(result).toBe('CALAuthScheme xyz');
  });
});
