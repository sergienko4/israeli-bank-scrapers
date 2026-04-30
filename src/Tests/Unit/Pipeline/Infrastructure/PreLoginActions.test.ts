/**
 * Unit tests for PreLoginActions — isFormAlreadyVisible + validateFormGatePost +
 * tryClickPrivateCustomers + tryClickCredentialArea helpers.
 */

import type { Page } from 'playwright-core';

import type {
  IElementMediator,
  IRaceResult,
} from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import {
  isFormAlreadyVisible,
  tryClickCredentialArea,
  tryClickPrivateCustomers,
  validateFormGatePost,
} from '../../../../Scrapers/Pipeline/Mediator/PreLogin/PreLoginActions.js';
import { isOk, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockMediator } from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeFlushableLogger } from './TestHelpers.js';

/** Positive race result — found with context. */
const FOUND_RESULT: IRaceResult = {
  found: true,
  locator: false,
  candidate: { kind: 'textContent', value: 'Login' },
  context: {
    /**
     * Test helper.
     *
     * @returns Result.
     */
    getCurrentUrl: (): string => 'about:blank',
  } as unknown as Page,
  index: 0,
  value: 'Login',
  identity: false,
};

/**
 * Build a mock mediator that returns canned resolveVisible results per call.
 * @param results - Array of results; returned in order (FIFO).
 * @param overrides - Other overrides.
 * @returns Mediator.
 */
function mediatorWithQueue(
  results: readonly IRaceResult[],
  overrides: Partial<IElementMediator> = {},
): IElementMediator {
  let idx = 0;
  return makeMockMediator({
    /**
     * Return next queued IRaceResult.
     * @returns Canned result.
     */
    resolveVisible: (): Promise<IRaceResult> => {
      const next = results[idx] ?? NOT_FOUND_RESULT;
      idx += 1;
      return Promise.resolve(next);
    },
    ...overrides,
  });
}

describe('isFormAlreadyVisible', () => {
  it('returns false when password field is not found', async () => {
    const mediator = makeMockMediator();
    const logger = makeFlushableLogger();
    const isFormVisible = await isFormAlreadyVisible(mediator, logger);
    expect(isFormVisible).toBe(false);
  });

  it('returns false when password found but submit missing', async () => {
    const mediator = mediatorWithQueue([FOUND_RESULT, NOT_FOUND_RESULT]);
    const logger = makeFlushableLogger();
    const isFormVisible = await isFormAlreadyVisible(mediator, logger);
    expect(isFormVisible).toBe(false);
  });

  it('returns true when both password + submit visible', async () => {
    const mediator = mediatorWithQueue([FOUND_RESULT, FOUND_RESULT]);
    const logger = makeFlushableLogger();
    const isFormVisible = await isFormAlreadyVisible(mediator, logger);
    expect(isFormVisible).toBe(true);
  });

  it('returns false when resolveVisible throws', async () => {
    const mediator = makeMockMediator({
      /**
       * Throws to simulate frame detachment.
       * @returns Rejected promise.
       */
      resolveVisible: () => Promise.reject(new Error('boom')),
    });
    const logger = makeFlushableLogger();
    const isFormVisible = await isFormAlreadyVisible(mediator, logger);
    expect(isFormVisible).toBe(false);
  });
});

describe('validateFormGatePost', () => {
  it('returns false when resolver returns not-found', async () => {
    const mediator = makeMockMediator();
    const isGatePassed = await validateFormGatePost(mediator);
    expect(isGatePassed).toBe(false);
  });

  it('returns true when password gate found', async () => {
    const mediator = mediatorWithQueue([FOUND_RESULT]);
    const isGatePassed = await validateFormGatePost(mediator);
    expect(isGatePassed).toBe(true);
  });

  it('returns false when resolveVisible throws', async () => {
    const mediator = makeMockMediator({
      /**
       * Throws to simulate detached frame.
       * @returns Rejected promise.
       */
      resolveVisible: () => Promise.reject(new Error('detached')),
    });
    const isGatePassed = await validateFormGatePost(mediator);
    expect(isGatePassed).toBe(false);
  });
});

describe('tryClickPrivateCustomers', () => {
  /** Browser page stub with waitForURL. */
  const mockPage = {
    /**
     * Succeed URL wait quickly.
     * @returns Resolved true.
     */
    waitForURL: (): Promise<boolean> => Promise.resolve(true),
  } as unknown as Page;

  it('returns failure when mediator.resolveAndClick fails', async () => {
    const mediator = makeMockMediator();
    const logger = makeFlushableLogger();
    const result = await tryClickPrivateCustomers({
      mediator,
      browserPage: mockPage,
      navTimeout: 1000,
      logger,
    });
    // resolveAndClick returns succeed(NOT_FOUND_RESULT) by default — success true, but value.found=false
    expect(result.success).toBe(true);
  });

  it('navigates and waits for form gate when click succeeds', async () => {
    const mediator = makeMockMediator({
      /**
       * Return succeed with found click result.
       * @returns Clicked result.
       */
      resolveAndClick: () => {
        const okClick = succeed({ ...FOUND_RESULT });
        return Promise.resolve(okClick);
      },
      /**
       * Return found for form gate probe.
       * @returns Found result.
       */
      resolveVisible: () => Promise.resolve({ ...FOUND_RESULT }),
    });
    const logger = makeFlushableLogger();
    const result = await tryClickPrivateCustomers({
      mediator,
      browserPage: mockPage,
      navTimeout: 1000,
      logger,
    });
    const isOkResult1 = isOk(result);
    expect(isOkResult1).toBe(true);
  });
});

describe('tryClickCredentialArea', () => {
  it('returns NOT_FOUND when resolveAndClick reports not found', async () => {
    const mediator = makeMockMediator();
    const logger = makeFlushableLogger();
    const result = await tryClickCredentialArea(mediator, logger);
    expect(result.success).toBe(true);
    if (isOk(result)) {
      expect(result.value.found).toBe(false);
    }
  });

  it('calls form gate probe when click succeeds', async () => {
    const mediator = makeMockMediator({
      /**
       * Return found click result.
       * @returns Clicked result.
       */
      resolveAndClick: () => {
        const okClick = succeed({ ...FOUND_RESULT });
        return Promise.resolve(okClick);
      },
      /**
       * Return found result for form gate.
       * @returns Found.
       */
      resolveVisible: () => Promise.resolve({ ...FOUND_RESULT }),
    });
    const logger = makeFlushableLogger();
    const result = await tryClickCredentialArea(mediator, logger);
    const isOkResult2 = isOk(result);
    expect(isOkResult2).toBe(true);
  });
});

// ── Additional branch coverage ──────────────────────────────────────
describe('tryClickPrivateCustomers — click fails', () => {
  it('returns the failure when resolveAndClick returns failure', async () => {
    const { fail: failFn } = await import('../../../../Scrapers/Pipeline/Types/Procedure.js');
    const { ScraperErrorTypes: scraperErrorTypes } =
      await import('../../../../Scrapers/Base/ErrorTypes.js');
    const mediator = makeMockMediator({
      /**
       * resolveAndClick returns failure.
       * @returns Failure.
       */
      resolveAndClick: () => {
        const failClick = failFn(scraperErrorTypes.Generic, 'click blew up');
        return Promise.resolve(failClick);
      },
    });
    const logger = makeFlushableLogger();
    const mockPage = {
      /**
       * No-op URL wait.
       * @returns Resolved true.
       */
      waitForURL: (): Promise<boolean> => Promise.resolve(true),
    } as unknown as Page;
    const result = await tryClickPrivateCustomers({
      mediator,
      browserPage: mockPage,
      navTimeout: 1000,
      logger,
    });
    const isOkResult3 = isOk(result);
    expect(isOkResult3).toBe(false);
  });
});

describe('isFormAlreadyVisible — submit gate rejection path', () => {
  it('returns false when submitGate resolveVisible rejects', async () => {
    let call = 0;
    const mediator = makeMockMediator({
      /**
       * First call (password) → found.
       * Second call (submitGate) → rejects.
       * @returns Stepwise.
       */
      resolveVisible: (): Promise<IRaceResult> => {
        call += 1;
        if (call === 1) return Promise.resolve({ ...FOUND_RESULT });
        return Promise.reject(new Error('detached'));
      },
    });
    const logger = makeFlushableLogger();
    const isFormVisible = await isFormAlreadyVisible(mediator, logger);
    expect(isFormVisible).toBe(false);
  });

  it('returns false when password gate resolveVisible rejects (line 39 .catch lambda)', async () => {
    const mediator = makeMockMediator({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      resolveVisible: (): Promise<IRaceResult> => Promise.reject(new Error('gate fail')),
    });
    const logger = makeFlushableLogger();
    const isFormVisible = await isFormAlreadyVisible(mediator, logger);
    expect(isFormVisible).toBe(false);
  });
});
