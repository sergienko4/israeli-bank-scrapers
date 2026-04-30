/**
 * Unit tests for generic pre-login helpers in HomeActions.
 * Tests tryClickLoginLink.
 * All use mediator — no direct page.getByText.
 * resolveAndClick returns Procedure<IRaceResult> per Rule #15.
 * Popup dismissal handled by PopupInterceptor (separate test).
 */

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import type {
  IElementMediator,
  IRaceResult,
} from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { tryClickLoginLink } from '../../../../Scrapers/Pipeline/Mediator/Home/HomeActions.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, isOk, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeMockFullPage,
  makeMockMediator,
} from '../../Scrapers/Pipeline/MockPipelineFactories.js';

/** Successful race result — element was found. */
const FOUND_RESULT: IRaceResult = {
  found: true,
  locator: makeMockFullPage().locator('mock').first(),
  candidate: { kind: 'textContent', value: 'כניסה' },
  context: makeMockFullPage(),
  index: 0,
  value: 'כניסה',
  identity: false,
};

/**
 * Build a mediator that succeeds on resolveAndClick.
 * @returns Mediator mock with succeed(FOUND_RESULT).
 */
function makeSuccessMediator(): IElementMediator {
  const successResult = succeed(FOUND_RESULT);
  const mediator = makeMockMediator({
    /**
     * Always find and click.
     * @returns Succeed with found race result.
     */
    resolveAndClick: (): Promise<Procedure<IRaceResult>> => Promise.resolve(successResult),
  });
  return mediator;
}

/**
 * Build a mediator that returns not-found on resolveAndClick.
 * @returns Mediator mock with succeed(NOT_FOUND_RESULT).
 */
function makeNotFoundMediator(): IElementMediator {
  const notFoundResult = succeed(NOT_FOUND_RESULT);
  const mediator = makeMockMediator({
    /**
     * Nothing found — returns succeed with NOT_FOUND_RESULT.
     * @returns Succeed with not-found race result.
     */
    resolveAndClick: (): Promise<Procedure<IRaceResult>> => Promise.resolve(notFoundResult),
  });
  return mediator;
}

describe('tryClickLoginLink', () => {
  it('returns success when mediator finds and clicks a login link', async () => {
    const mediator = makeSuccessMediator();
    const result = await tryClickLoginLink(mediator);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (result.success) {
      expect(result.value.found).toBe(true);
    }
  });

  it('returns success with not-found when mediator finds no login link', async () => {
    const mediator = makeNotFoundMediator();
    const result = await tryClickLoginLink(mediator);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (result.success) {
      expect(result.value.found).toBe(false);
    }
  });

  it('returns failure when mediator errors', async () => {
    const errorResult = fail(ScraperErrorTypes.Generic, 'timeout');
    const mediator = makeMockMediator({
      /**
       * Return failure Procedure.
       * @returns Failure procedure.
       */
      resolveAndClick: (): Promise<Procedure<IRaceResult>> => Promise.resolve(errorResult),
    });
    const result = await tryClickLoginLink(mediator);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(false);
  });
});
