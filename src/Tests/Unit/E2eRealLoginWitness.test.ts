/**
 * LoginWitness — unit coverage for the login-completion observer.
 *
 * <p>The warm-path fallback refuses a retry unless the witness can show the
 * run's only completed login re-reported the cached token. That makes the
 * witness's own edge cases load-bearing: an empty report must not be mistaken
 * for a login, a later cold mint must override an earlier warm one, and a
 * failing cache write must not erase the evidence.
 *
 * Fixtures are synthetic and carry zero PII.
 */

import type { IAuthFlowInfo } from '../../Scrapers/Base/Interface.js';
import { createLoginWitness } from '../E2eReal/LoginWitness.js';

/** Error type for the throwing-sink case (bare `throw new Error` is banned). */
class SinkFailure extends Error {}

/**
 * A sink that always fails, standing in for a full disk.
 * @returns A rejected promise.
 */
function failingSink(): Promise<void> {
  return Promise.reject(new SinkFailure('disk full'));
}

/**
 * Build a callback payload carrying the given long-term token.
 * @param longTermToken - Token the pipeline reports.
 * @returns Payload double.
 */
function info(longTermToken: string): IAuthFlowInfo {
  return { longTermToken, bearer: 'bearer-value' };
}

/**
 * Build a sink that records every payload it receives.
 * @param sink - Array receiving the tokens, in order.
 * @returns Writer double.
 */
function recordingSink(sink: string[]): (payload: IAuthFlowInfo) => Promise<void> {
  return (payload: IAuthFlowInfo): Promise<void> => {
    sink.push(payload.longTermToken);
    return Promise.resolve();
  };
}

describe('createLoginWitness', () => {
  it('reports nothing before any login completes', () => {
    const sink = recordingSink([]);
    const witness = createLoginWitness(sink);

    const token = witness.lastToken();
    expect(token).toBe('');
  });

  it('reports the token of the login that completed', async () => {
    const sink = recordingSink([]);
    const witness = createLoginWitness(sink);
    const payload1 = info('warm-seed');
    await witness.writer(payload1);

    const token = witness.lastToken();
    expect(token).toBe('warm-seed');
  });

  it('reports the latest token when a mid-scrape refresh re-mints', async () => {
    const sink = recordingSink([]);
    const witness = createLoginWitness(sink);
    const payload2 = info('warm-seed');
    await witness.writer(payload2);
    const payload3 = info('re-minted');
    await witness.writer(payload3);

    const token = witness.lastToken();
    expect(token).toBe('re-minted');
  });

  it('ignores an empty report, which proves no login completed', async () => {
    const sink = recordingSink([]);
    const witness = createLoginWitness(sink);
    const payload4 = info('warm-seed');
    await witness.writer(payload4);
    const payload5 = info('');
    await witness.writer(payload5);

    const token = witness.lastToken();
    expect(token).toBe('warm-seed');
  });

  it('forwards every payload to the sink it wraps', async () => {
    const seen: string[] = [];
    const sink = recordingSink(seen);
    const witness = createLoginWitness(sink);
    const payload6 = info('first');
    await witness.writer(payload6);
    const payload7 = info('second');
    await witness.writer(payload7);

    expect(seen).toEqual(['first', 'second']);
  });

  it('keeps the evidence when the cache write fails', async () => {
    const witness = createLoginWitness(failingSink);
    const payloadLost = info('minted-then-lost');
    const attempt = witness.writer(payloadLost);
    await expect(attempt).rejects.toThrow('disk full');

    const token = witness.lastToken();
    expect(token).toBe('minted-then-lost');
  });
});
