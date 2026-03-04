import type { Page } from 'playwright';
import type { Falsy } from 'utility-types';

import type { ReloadRetryResult } from '../Interfaces/Common/ReloadRetryResult';
import type { WaitUntilOpts } from '../Interfaces/Common/WaitUntilOpts';

export type { ReloadRetryResult } from '../Interfaces/Common/ReloadRetryResult';
export type { WaitUntilOpts } from '../Interfaces/Common/WaitUntilOpts';

export class TimeoutError extends Error {}

export const SECOND = 1000;

type WaitUntilReturn<T> = T extends Falsy ? never : Promise<NonNullable<T>>;

function timeoutPromise<T>(ms: number, promise: Promise<T>, description: string): Promise<T> {
  const timeout = new Promise((_, reject) => {
    const id = setTimeout(() => {
      clearTimeout(id);
      const error = new TimeoutError(description);
      reject(error);
    }, ms);
  });

  return Promise.race([
    promise,
    // casting to avoid type error- safe since this promise will always reject
    timeout as Promise<T>,
  ]);
}

function makeWaitTick<T>(
  asyncTest: () => Promise<T>,
  interval: number,
  cbs: { resolve: (v: NonNullable<T>) => void; reject: () => void },
): () => void {
  function wait(): void {
    asyncTest()
      .then(value => {
        if (value) cbs.resolve(value as unknown as NonNullable<T>);
        else setTimeout(wait, interval);
      })
      .catch(() => {
        cbs.reject();
      });
  }
  return wait;
}

function buildWaitPromise<T>(
  asyncTest: () => Promise<T>,
  interval: number,
): Promise<NonNullable<T>> {
  return new Promise<NonNullable<T>>((resolve, reject) => {
    makeWaitTick(asyncTest, interval, { resolve, reject })();
  });
}

function safeStringify(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return typeof s === 'string' ? s.slice(0, 100) : 'undefined';
  } catch {
    return String(v).slice(0, 100);
  }
}

/**
 * Wait until a promise resolves with a truthy value or reject after a timeout.
 * On timeout the error message includes the last polled value for diagnostics.
 */
export function waitUntil<T>(
  asyncTest: () => Promise<T>,
  description = '',
  opts: WaitUntilOpts = {},
): WaitUntilReturn<T> {
  const { timeout = 10000, interval = 100 } = opts;
  let lastSeenValue: unknown;
  const trackingTest = async (): Promise<T> => {
    const v = await asyncTest();
    lastSeenValue = v;
    return v;
  };
  const promise = buildWaitPromise(trackingTest, interval);
  const withContext = timeoutPromise(timeout, promise, description).catch((e: unknown) => {
    if (!(e instanceof TimeoutError)) throw e;
    throw new TimeoutError(`${e.message} — last: ${safeStringify(lastSeenValue)}`);
  });
  return withContext as WaitUntilReturn<T>;
}

async function retryWithReload<T>(
  page: Page,
  asyncTest: () => Promise<T>,
  opts: { label: string; pollTimeout: number; interval: number; left: number; used: number },
): Promise<ReloadRetryResult<T>> {
  const { label, pollTimeout, interval, left, used } = opts;
  const result = await waitUntil(asyncTest, label, { timeout: pollTimeout, interval }).catch(
    () => null,
  );
  if (result !== null)
    return { found: true, value: result as NonNullable<T>, reloadsUsed: used, description: label };
  if (left <= 0) return { found: false, value: null, reloadsUsed: used, description: label };
  await page.reload({ waitUntil: 'networkidle' });
  return retryWithReload(page, asyncTest, { ...opts, left: left - 1, used: used + 1 });
}

/**
 * Like waitUntil, but reloads the page on timeout and retries.
 * Returns a result object — never throws. Caller decides what to do when found=false.
 * Use when a bank's SPA needs a page refresh to complete post-login JS initialization
 * (e.g. writing an auth token to sessionStorage) that stalls in headless mode.
 */
export async function waitUntilWithReload<T>(
  page: Page,
  asyncTest: () => Promise<T>,
  opts: { description?: string; pollTimeout?: number; reloadAttempts?: number; interval?: number },
): Promise<ReloadRetryResult<T>> {
  const {
    description = 'waitUntilWithReload',
    pollTimeout = 20_000,
    reloadAttempts = 2,
    interval = 500,
  } = opts;
  return retryWithReload(page, asyncTest, {
    label: description,
    pollTimeout,
    interval,
    left: reloadAttempts,
    used: 0,
  });
}

export function raceTimeout(ms: number, promise: Promise<unknown>): Promise<unknown> {
  return timeoutPromise(ms, promise, 'timeout').catch((err: unknown) => {
    if (!(err instanceof TimeoutError)) throw err;
  });
}

export function runSerial<T>(actions: (() => Promise<T>)[]): Promise<T[]> {
  return actions.reduce(
    (m, a) => m.then(async x => [...x, await a()]),
    Promise.resolve<T[]>(new Array<T>()),
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Random delay that mimics human interaction timing.
 * Default range: 300-1200ms (realistic for clicks and navigation).
 */
export function humanDelay(minMs = 300, maxMs = 1200): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
  return sleep(delay);
}
