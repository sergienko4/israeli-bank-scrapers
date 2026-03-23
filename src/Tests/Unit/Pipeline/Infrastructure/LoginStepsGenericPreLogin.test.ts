/**
 * Unit tests for generic preLogin helpers in LoginSteps.
 * Tests tryClosePopup, tryClickLoginLink, tryClickPrivateCustomers.
 * All use mediator.resolveAndClick — no direct page.getByText.
 */

import type { Page } from 'playwright-core';

import type { IElementMediator } from '../../../../Scrapers/Pipeline/Mediator/ElementMediator.js';
import {
  tryClickLoginLink,
  tryClickPrivateCustomers,
  tryClosePopup,
} from '../../../../Scrapers/Pipeline/Phases/GenericPreLoginSteps.js';
import { makeMockMediator } from '../../Scrapers/Pipeline/MockPipelineFactories.js';

/**
 * Build a mediator that succeeds on resolveAndClick.
 * @returns Mediator mock that always resolves true.
 */
function makeSuccessMediator(): IElementMediator {
  return makeMockMediator({
    /**
     * Always find and click.
     * @returns True.
     */
    resolveAndClick: (): Promise<boolean> => Promise.resolve(true),
  });
}

/**
 * Build a mediator that fails on resolveAndClick.
 * @returns Mediator mock that always resolves false.
 */
function makeFailMediator(): IElementMediator {
  return makeMockMediator({
    /**
     * Nothing found.
     * @returns False.
     */
    resolveAndClick: (): Promise<boolean> => Promise.resolve(false),
  });
}

describe('tryClosePopup', () => {
  it('returns true when mediator finds and clicks close element', async () => {
    const mediator = makeSuccessMediator();
    const didClose = await tryClosePopup(mediator);
    expect(didClose).toBe(true);
  });

  it('returns false when mediator finds nothing', async () => {
    const mediator = makeFailMediator();
    const didClose = await tryClosePopup(mediator);
    expect(didClose).toBe(false);
  });

  it('returns false when mediator throws', async () => {
    const mediator = makeMockMediator({
      /**
       * Throw to simulate error.
       * @returns Rejected.
       */
      resolveAndClick: (): Promise<boolean> => Promise.reject(new Error('fail')),
    });
    const didClose = await tryClosePopup(mediator);
    expect(didClose).toBe(false);
  });
});

describe('tryClickLoginLink', () => {
  it('returns true when mediator finds login link', async () => {
    const mediator = makeSuccessMediator();
    const didClick = await tryClickLoginLink(mediator);
    expect(didClick).toBe(true);
  });

  it('returns false when mediator finds nothing', async () => {
    const mediator = makeFailMediator();
    const didClick = await tryClickLoginLink(mediator);
    expect(didClick).toBe(false);
  });
});

describe('tryClickPrivateCustomers', () => {
  it('returns true when mediator clicks and page navigates', async () => {
    const mediator = makeSuccessMediator();
    const page = {
      /**
       * Simulate navigation to /login.
       * @returns Resolved.
       */
      waitForURL: (): Promise<boolean> => Promise.resolve(true),
    } as unknown as Page;
    const didClick = await tryClickPrivateCustomers(mediator, page, 15000);
    expect(didClick).toBe(true);
  });

  it('returns false when mediator finds nothing', async () => {
    const mediator = makeFailMediator();
    const page = {} as unknown as Page;
    const didClick = await tryClickPrivateCustomers(mediator, page, 15000);
    expect(didClick).toBe(false);
  });
});
