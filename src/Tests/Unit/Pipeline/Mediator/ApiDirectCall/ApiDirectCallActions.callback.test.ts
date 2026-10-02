/**
 * Log-safety oracle for the onAuthFlowComplete dispatcher.
 *
 * A caller callback that throws may echo its payload (the long-term
 * token or the bearer) in the error text. The warn line must carry
 * that text only as a `<msg:N>` length tag, never verbatim.
 */

import { invokeAuthFlowComplete } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ApiDirectCallActions.callback.js';
import type { IConfigTokenStrategy } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/TokenStrategyFromConfig.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';

/** Auth-flow callback payload the dispatcher forwards. */
interface IAuthPayload {
  readonly longTermToken: string;
  readonly bearer: string;
}

const LONG_TERM_TOKEN = 'ltt-canary-9f2c7e41b8';
const BEARER = 'Bearer brr-canary-5d03a6c2e7';

/**
 * Strategy stub exposing only the long-term token getter.
 * @returns Minimal config-strategy stub.
 */
function strategyStub(): IConfigTokenStrategy {
  /**
   * Latest long-term token.
   * @returns The canary long-term token.
   */
  function getLatestLongTermToken(): string {
    return LONG_TERM_TOKEN;
  }
  return { getLatestLongTermToken } as unknown as IConfigTokenStrategy;
}

/**
 * Callback that throws an error echoing its whole payload.
 * @param payload - Auth-flow payload from the dispatcher.
 * @returns A promise rejected with the echoing error.
 */
function echoingCallback(payload: IAuthPayload): Promise<never> {
  const echo = `persist failed for ${payload.longTermToken} / ${payload.bearer}`;
  const error = new Error(echo);
  return Promise.reject(error);
}

/**
 * Pipeline-context stub whose logger records every warn line.
 * @param sink - Array receiving each warn record as JSON.
 * @returns Minimal pipeline context.
 */
function ctxStub(sink: string[]): IPipelineContext {
  /**
   * Record one warn call.
   * @param record - Structured log record.
   * @returns true (ack).
   */
  function warn(record: object): boolean {
    const line = JSON.stringify(record);
    sink.push(line);
    return true;
  }
  const options = { onAuthFlowComplete: echoingCallback };
  return { options, logger: { warn } } as unknown as IPipelineContext;
}

describe('invokeAuthFlowComplete — callback throw log safety', () => {
  it('logs the thrown text as a length tag without the token or bearer', async () => {
    const lines: string[] = [];
    const ctx = ctxStub(lines);
    const strategy = strategyStub();
    const isDone = await invokeAuthFlowComplete(ctx, strategy, BEARER);
    const logged = lines.join('\n');
    expect(isDone).toBe(false);
    expect(lines).toHaveLength(1);
    expect(logged).toContain('<msg:');
    expect(logged).not.toContain(LONG_TERM_TOKEN);
    expect(logged).not.toContain(BEARER);
  });
});
