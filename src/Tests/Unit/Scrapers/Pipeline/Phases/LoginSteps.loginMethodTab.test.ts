/**
 * Unit tests for LoginSteps.tryClickCredentialArea.
 * Verifies generic tab detection — clicks when present, skips when absent.
 * resolveAndClick returns Procedure<IRaceResult> per Rule #15.
 */

import type { IRaceResult } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { tryClickCredentialArea } from '../../../../../Scrapers/Pipeline/Mediator/PreLogin/PreLoginActions.js';
import type { ScraperLogger } from '../../../../../Scrapers/Pipeline/Types/Debug.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { isOk, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockFullPage, makeMockMediator } from '../MockPipelineFactories.js';

/** Found race result — element clicked. */
const FOUND: IRaceResult = {
  found: true,
  locator: makeMockFullPage().locator('mock').first(),
  candidate: { kind: 'textContent', value: 'כניסה עם סיסמה' },
  context: makeMockFullPage(),
  index: 0,
  value: 'כניסה עם סיסמה',
};

/** Whether mock logger call succeeded. */
type LoggerNoop = boolean;

/**
 * No-op function for mock logger methods.
 * @returns true.
 */
const NOOP = (): LoggerNoop => true;

/** No-op mock logger for tests — all methods return true. */
const MOCK_LOGGER = {
  trace: NOOP,
  debug: NOOP,
  info: NOOP,
  warn: NOOP,
  error: NOOP,
} as unknown as ScraperLogger;

describe('tryClickCredentialArea', () => {
  it('returns succeed with found=true when mediator clicks a tab', async () => {
    const found = succeed(FOUND);
    const mediator = makeMockMediator({
      /**
       * Simulate finding and clicking a tab.
       * @returns Succeed with found result.
       */
      resolveAndClick: (): Promise<Procedure<IRaceResult>> => Promise.resolve(found),
    });
    const result = await tryClickCredentialArea(mediator, MOCK_LOGGER);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (result.success) expect(result.value.found).toBe(true);
  });

  it('returns succeed with found=false when no tab found', async () => {
    const notFound = succeed(NOT_FOUND_RESULT);
    const mediator = makeMockMediator({
      /**
       * Simulate not finding any tab.
       * @returns Succeed with NOT_FOUND_RESULT.
       */
      resolveAndClick: (): Promise<Procedure<IRaceResult>> => Promise.resolve(notFound),
    });
    const result = await tryClickCredentialArea(mediator, MOCK_LOGGER);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (result.success) expect(result.value.found).toBe(false);
  });
});
