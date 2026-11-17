/**
 * Bound caller-owned callbacks: a callback that never settles must not hold a
 * scrape open forever. The timer is unref'd and cleared once the callback
 * settles, so a finished run leaves no live timer behind.
 */

import ScraperError from '../../Base/ScraperError.js';

/** Default wait for a caller callback, in milliseconds. */
const DEFAULT_CALLBACK_TIMEOUT_MS = 30_000;

/**
 * Build the abort listener that rejects the deadline promise.
 * @param reject - The deadline promise's reject function.
 * @returns The listener, which reports a handled event.
 */
function failOnAbort(reject: (error: unknown) => unknown): () => boolean {
  return (): boolean => {
    const failure = new ScraperError('callback timed out');
    reject(failure);
    return true;
  };
}

/**
 * Build a promise that rejects when the signal aborts.
 * @param signal - Deadline signal.
 * @returns The rejecting promise.
 */
function deadlineFailure(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    const listener = failOnAbort(reject);
    signal.addEventListener('abort', listener, { once: true });
  });
}

/**
 * Race a callback against its deadline.
 * @param work - The callback's promise.
 * @param timeoutMs - Maximum wait; the default applies when absent.
 * @returns The callback's result.
 * @throws ScraperError when the deadline wins.
 */
async function withCallbackDeadline<T>(work: Promise<T>, timeoutMs?: number): Promise<T> {
  const ms = timeoutMs ?? DEFAULT_CALLBACK_TIMEOUT_MS;
  const signal = AbortSignal.timeout(ms);
  const timeout = deadlineFailure(signal);
  return Promise.race([work, timeout]);
}

export default withCallbackDeadline;
