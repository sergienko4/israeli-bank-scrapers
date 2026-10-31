/**
 * D12 — an `onAuthFlowComplete` callback that throws is logged by its error
 * name only. The callback was handed the long-term token and the bearer, so
 * its message may repeat either; the scrape still succeeds.
 */

import { jest } from '@jest/globals';

import { invokeAuthFlowComplete } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ApiDirectCallActions.callback.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

const LONG_TERM_TOKEN = 'syn-ltt-7741';
const BEARER = 'syn-bearer-1209';

/**
 * A callback that fails, quoting both secrets it was handed.
 * @returns A rejected promise.
 */
function throwingCallback(): Promise<void> {
  const error = new RangeError(`sink refused ${LONG_TERM_TOKEN} ${BEARER}`);
  return Promise.reject(error);
}

/**
 * The long-term token the strategy captured.
 * @returns The token.
 */
function latestToken(): string {
  return LONG_TERM_TOKEN;
}

/**
 * A pipeline context whose options carry the throwing callback.
 * @returns Pipeline context.
 */
function callbackCtx(): IPipelineContext {
  const base = makeMockContext();
  const options = { ...base.options, onAuthFlowComplete: throwingCallback };
  return { ...base, options };
}

describe('invokeAuthFlowComplete — callback throw', () => {
  it('logs the error name, never the message', async () => {
    const ctx = callbackCtx();
    const warn = jest.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined);
    const strategy = { getLatestLongTermToken: latestToken };
    const isDone = await invokeAuthFlowComplete(ctx, strategy, BEARER);
    expect(isDone).toBe(false);
    expect(warn).toHaveBeenCalledWith({
      message: 'api-direct-call onAuthFlowComplete callback threw RangeError',
    });
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain(LONG_TERM_TOKEN);
    expect(logged).not.toContain(BEARER);
  });
});
