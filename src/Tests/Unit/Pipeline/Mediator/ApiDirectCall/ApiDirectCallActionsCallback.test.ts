/**
 * D12 — an `onAuthFlowComplete` callback that throws is logged by its error
 * name only. The callback was handed the long-term token and the bearer, so
 * its message — or a name it sets — may repeat either; a name that is not a
 * plain class name is logged as `Error`. The scrape still succeeds.
 */

import { jest } from '@jest/globals';

import { invokeAuthFlowComplete } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ApiDirectCallActions.callback.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

const LONG_TERM_TOKEN = 'syn-ltt-7741';
const BEARER = 'syn-bearer-1209';

/** An `onAuthFlowComplete` callback. */
type AuthFlowCallback = () => Promise<void>;

/**
 * A callback that fails with the given error name, quoting both secrets it
 * was handed in the message.
 * @param name - Name set on the thrown error.
 * @returns The callback.
 */
function throwingCallback(name: string): AuthFlowCallback {
  return (): Promise<void> => {
    const error = new RangeError(`sink refused ${LONG_TERM_TOKEN} ${BEARER}`);
    error.name = name;
    return Promise.reject(error);
  };
}

/**
 * The long-term token the strategy captured.
 * @returns The token.
 */
function latestToken(): string {
  return LONG_TERM_TOKEN;
}

/**
 * A pipeline context whose options carry the callback.
 * @param callback - The `onAuthFlowComplete` callback.
 * @returns Pipeline context.
 */
function callbackCtx(callback: AuthFlowCallback): IPipelineContext {
  const base = makeMockContext();
  const options = { ...base.options, onAuthFlowComplete: callback };
  return { ...base, options };
}

describe('invokeAuthFlowComplete — callback throw', () => {
  it.each([
    ['RangeError', 'RangeError'],
    [BEARER, 'Error'],
    [`${LONG_TERM_TOKEN}Error`, 'Error'],
  ])('logs the error name %s as %s, never the message', async (name, logged) => {
    const callback = throwingCallback(name);
    const ctx = callbackCtx(callback);
    const warn = jest.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined);
    const strategy = { getLatestLongTermToken: latestToken };
    const isDone = await invokeAuthFlowComplete(ctx, strategy, BEARER);
    expect(isDone).toBe(false);
    expect(warn).toHaveBeenCalledWith({
      message: `api-direct-call onAuthFlowComplete callback threw ${logged}`,
    });
    const calls = JSON.stringify(warn.mock.calls);
    expect(calls).not.toContain(LONG_TERM_TOKEN);
    expect(calls).not.toContain(BEARER);
  });
});
