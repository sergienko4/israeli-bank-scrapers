/**
 * Unit tests for PreLoginRevealProbe — reveal status detection.
 */

import type {
  IElementMediator,
  IRaceResult,
} from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { probeRevealStatus } from '../../../../Scrapers/Pipeline/Mediator/PreLogin/PreLoginRevealProbe.js';
import { makeMockMediator } from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeFlushableLogger } from './TestHelpers.js';

/** Visible-and-found race result. */
const FOUND: IRaceResult = {
  found: true,
  locator: false,
  candidate: { kind: 'textContent', value: 'Private' },
  context: {} as unknown as IRaceResult['context'],
  index: 0,
  value: 'Private',
  identity: false,
};

describe('probeRevealStatus', () => {
  it('returns NOT_FOUND when resolveVisible returns not-found and countByText is 0', async () => {
    const mediator = makeMockMediator();
    const logger = makeFlushableLogger();
    const status = await probeRevealStatus(mediator, 100, logger);
    expect(status).toBe('NOT_FOUND');
  });

  it('returns READY when visible and found', async () => {
    const mediator = makeMockMediator({
      /**
       * Return visible FOUND result.
       * @returns Found.
       */
      resolveVisible: () => Promise.resolve(FOUND),
    });
    const logger = makeFlushableLogger();
    const status = await probeRevealStatus(mediator, 100, logger);
    expect(status).toBe('READY');
  });

  it('returns OBSCURED when not visible but countByText > 0', async () => {
    const mediator: IElementMediator = makeMockMediator({
      /**
       * Not visible.
       * @returns NOT_FOUND_RESULT.
       */
      resolveVisible: () => Promise.resolve(NOT_FOUND_RESULT),
      /**
       * Element exists in DOM.
       * @returns 1.
       */
      countByText: () => Promise.resolve(1),
    });
    const logger = makeFlushableLogger();
    const status = await probeRevealStatus(mediator, 100, logger);
    expect(status).toBe('OBSCURED');
  });

  it('returns NOT_FOUND when resolveVisible rejects and DOM has nothing', async () => {
    const mediator = makeMockMediator({
      /**
       * Throws.
       * @returns Rejected.
       */
      resolveVisible: () => Promise.reject(new Error('detached')),
    });
    const logger = makeFlushableLogger();
    const status = await probeRevealStatus(mediator, 100, logger);
    expect(status).toBe('NOT_FOUND');
  });
});
