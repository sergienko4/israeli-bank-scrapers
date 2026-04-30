/**
 * Unit tests for HomeActions — legacy compat helpers (tryClickLoginLink, waitForAnyLoginLink).
 */

import type { Frame, Locator, Page } from 'playwright-core';

import type {
  IElementMediator,
  IRaceResult,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import {
  tryClickLoginLink,
  waitForAnyLoginLink,
} from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeActions.js';
import { succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

/**
 * Build a mediator stub that returns a given resolveAndClick result.
 * @param result - Race result to return.
 * @returns Mock mediator.
 */
function makeMediator(result: IRaceResult): IElementMediator {
  return {
    /**
     * resolveAndClick.
     * @returns Succeed with result.
     */
    resolveAndClick: () => {
      const succeeded = succeed(result);
      return Promise.resolve(succeeded);
    },
  } as unknown as IElementMediator;
}

describe('tryClickLoginLink', () => {
  it('passes-through resolveAndClick success=false', async () => {
    const mediator = makeMediator(NOT_FOUND_RESULT);
    const result = await tryClickLoginLink(mediator);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.found).toBe(false);
  });

  it('passes-through resolveAndClick success=true', async () => {
    const mediator = makeMediator({ ...NOT_FOUND_RESULT, found: true as const });
    const result = await tryClickLoginLink(mediator);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.found).toBe(true);
  });
});

describe('waitForAnyLoginLink', () => {
  /**
   * Build a mock locator whose waitFor resolves/rejects.
   * @param ok - Whether waitFor resolves.
   * @returns Mock locator.
   */
  const makeLocator = (ok: boolean): Locator =>
    ({
      /**
       * first.
       * @returns Self.
       */
      first: (): Locator => makeLocator(ok),
      /**
       * waitFor.
       * @returns Resolves/rejects per flag.
       */
      waitFor: (): Promise<boolean> =>
        ok ? Promise.resolve(true) : Promise.reject(new Error('t/o')),
    }) as unknown as Locator;

  it('returns true when at least one login link resolves', async () => {
    const page = {
      /**
       * getByText — returns successful locator.
       * @returns Locator.
       */
      getByText: (): Locator => makeLocator(true),
    } as unknown as Page;
    expect(await waitForAnyLoginLink(page)).toBe(true);
  });

  it('returns false when all waitFor reject', async () => {
    const page = {
      /**
       * getByText — returns failing locator.
       * @returns Locator.
       */
      getByText: (): Locator => makeLocator(false),
    } as unknown as Page;
    expect(await waitForAnyLoginLink(page)).toBe(false);
  });

  it('returns true even when called with Frame-shaped objects via getByText', async () => {
    const page = {
      /**
       * getByText.
       * @returns Locator.
       */
      getByText: (): Locator => makeLocator(true),
    } as unknown as Frame;
    expect(await waitForAnyLoginLink(page as unknown as Page)).toBe(true);
  });
});
