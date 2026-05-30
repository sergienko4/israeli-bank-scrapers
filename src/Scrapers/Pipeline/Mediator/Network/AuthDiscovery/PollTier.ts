/**
 * AuthDiscovery Tier 4 — poll auth-module across all frames.
 *
 * Uses Playwright `waitForFunction` per frame (native polling — no
 * manual setTimeout).
 */

import type { Frame, JSHandle, Page } from 'playwright-core';

import { getDebug } from '../../../Types/Debug.js';
import { AUTH_POLL_INTERVAL, AUTH_POLL_TIMEOUT, tryParseJsonToken } from './Tokens.js';

const LOG = getDebug(import.meta.url);

/**
 * Resolve a Playwright JSHandle to a token string when possible.
 * @param handle - Awaited handle holding the auth-module JSON.
 * @returns Token or false.
 */
export async function handleToToken(handle: JSHandle): Promise<string | false> {
  const raw = (await handle.jsonValue()) as string;
  if (!raw) return false;
  return tryParseJsonToken(raw);
}

/**
 * Build a per-frame waiter that resolves with the parsed token or false.
 * @param frame - Playwright frame.
 * @returns Promise resolving to token or false.
 */
function buildFrameWaiter(frame: Frame): Promise<string | false> {
  return frame
    .waitForFunction((): string => sessionStorage.getItem('auth-module') ?? '', {
      polling: AUTH_POLL_INTERVAL,
      timeout: AUTH_POLL_TIMEOUT,
    })
    .then(handleToToken)
    .catch((): false => false);
}

/**
 * Collect tokens from all settled waiters, picking the first hit.
 * @param results - Settled per-frame waiter results.
 * @returns Token or false.
 */
function firstWaiterToken(
  results: readonly PromiseSettledResult<string | false>[],
): string | false {
  const tokens = results
    .filter((r): boolean => r.status === 'fulfilled' && r.value !== false)
    .map((r): string => (r as PromiseFulfilledResult<string>).value);
  if (tokens.length === 0) return false;
  return tokens[0];
}

/**
 * Emit the poll-hit trace line for {@link pollForAuthModule}. Pulled
 * out so the orchestrator fits the 10-LoC cap.
 * @param startMs - Poll start timestamp.
 * @returns True after the trace fires.
 */
function logPollHit(startMs: number): true {
  const elapsed = String(Date.now() - startMs);
  LOG.trace({ message: `auth-module found after ${elapsed}ms` });
  return true;
}

/**
 * Poll all frames for auth-module until it appears or timeout.
 * @param page - Playwright page.
 * @returns Token or false.
 */
export async function pollForAuthModule(page: Page): Promise<string | false> {
  LOG.trace({ message: 'polling auth-module across frames' });
  const startMs = Date.now();
  const waiters = page.frames().map(buildFrameWaiter);
  const results = await Promise.allSettled(waiters);
  const token = firstWaiterToken(results);
  if (token) logPollHit(startMs);
  return token;
}
