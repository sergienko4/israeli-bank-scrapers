import type { Falsy } from 'utility-types';

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

interface WaitCallbacks<T> {
  resolve: (v: NonNullable<T>) => void;
  reject: () => void;
}

function makeWaitTick<T>(
  asyncTest: () => Promise<T>,
  interval: number,
  cbs: WaitCallbacks<T>,
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

export interface WaitUntilOpts {
  timeout?: number;
  interval?: number;
}

/**
 * Wait until a promise resolves with a truthy value or reject after a timeout
 */
export function waitUntil<T>(
  asyncTest: () => Promise<T>,
  description = '',
  opts: WaitUntilOpts = {},
): WaitUntilReturn<T> {
  const { timeout = 10000, interval = 100 } = opts;
  const promise = buildWaitPromise(asyncTest, interval);
  return timeoutPromise(timeout, promise, description) as WaitUntilReturn<T>;
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
