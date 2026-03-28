/**
 * Unit tests for generic pre-login helpers in GenericPreLoginSteps.
 * Tests tryClosePopup, discoverLoginClickable.
 * All use mediator — no direct page.getByText.
 */

import type { IFieldContext } from '../../../../Common/SelectorResolverPipeline.js';
import type { IElementMediator } from '../../../../Scrapers/Pipeline/Mediator/ElementMediator.js';
import {
  discoverLoginClickable,
  tryClosePopup,
} from '../../../../Scrapers/Pipeline/Phases/GenericPreLoginSteps.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockMediator } from '../../Scrapers/Pipeline/MockPipelineFactories.js';

/** Build a mock resolveClickable that returns given selector. */
function mockResolveClickable(selector: string): () => Promise<Procedure<IFieldContext>> {
  const result: Procedure<IFieldContext> = {
    success: true,
    value: { isResolved: selector !== '', selector, context: {} as never, resolvedVia: 'wellKnown', round: 'mainPage' },
  };
  return (): Promise<Procedure<IFieldContext>> => Promise.resolve(result);
}

/**
 * Build a mediator that succeeds on resolveAndClick.
 * @returns Mediator mock that always resolves true.
 */
function makeSuccessMediator(): IElementMediator {
  return makeMockMediator({
    /** Always find and click. */
    resolveAndClick: (): Promise<boolean> => Promise.resolve(true),
  });
}

/**
 * Build a mediator that fails on resolveAndClick.
 * @returns Mediator mock that always resolves false.
 */
function makeFailMediator(): IElementMediator {
  return makeMockMediator({
    /** Nothing found. */
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
      /** Simulate error. */
      resolveAndClick: (): Promise<boolean> => Promise.reject(new Error('fail')),
    });
    const didClose = await tryClosePopup(mediator);
    expect(didClose).toBe(false);
  });
});

describe('discoverLoginClickable', () => {
  it('returns selector when mediator resolves a clickable login element', async () => {
    const mediator = makeMockMediator({
      resolveClickable: mockResolveClickable('#loginBtn'),
    });
    const selector = await discoverLoginClickable(mediator);
    expect(selector).toBe('#loginBtn');
  });

  it('returns empty string when mediator finds no clickable', async () => {
    const mediator = makeMockMediator({
      resolveClickable: mockResolveClickable(''),
    });
    const selector = await discoverLoginClickable(mediator);
    expect(selector).toBe('');
  });

  it('returns null when mediator throws', async () => {
    const mediator = makeMockMediator({
      /** Simulate error. */
      resolveClickable: (): Promise<never> => Promise.reject(new Error('timeout')),
    });
    const selector = await discoverLoginClickable(mediator);
    expect(selector).toBeNull();
  });
});
