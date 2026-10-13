/**
 * Unit tests for the abandoned-launch disposal path in CamoufoxLauncher.
 *
 * <p>Bounding the launch abandons — but cannot cancel — the in-flight
 * start. A browser that finishes coming up after the bound elapsed would
 * otherwise stay open with no reference left to close it, leaking a
 * Firefox process for the life of the host process. These tests drive
 * that race deterministically by mocking camoufox-js, so no OS process
 * is started.
 */

import { jest } from '@jest/globals';

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';

/** The part of a launched browser this module is responsible for. */
interface IClosableBrowser {
  close: () => Promise<unknown>;
}

/** A launch whose arrival time the test controls. */
interface IDeferredLaunch {
  readonly launch: Promise<IClosableBrowser>;
  readonly arrive: (browser: IClosableBrowser) => unknown;
}

const CAMOUFOX_MOCK = jest.fn();
const STACK_CHECK_MOCK = jest.fn(() => Promise.resolve(0));

jest.unstable_mockModule('@hieutran094/camoufox-js', () => ({ Camoufox: CAMOUFOX_MOCK }));
jest.unstable_mockModule(
  '../../../../../Scrapers/Pipeline/Mediator/Browser/BrowserStackCheck.js',
  () => ({ checkBrowserStack: STACK_CHECK_MOCK }),
);

const { CAMOUFOX_LAUNCH_TIMEOUT_ENV, launchCamoufox: LAUNCH_CAMOUFOX } =
  await import('../../../../../Scrapers/Pipeline/Mediator/Browser/CamoufoxLauncher.js');

/**
 * Build a launch promise the test settles by hand.
 *
 * @returns The pending launch plus the resolver that makes it arrive.
 */
function deferLaunch(): IDeferredLaunch {
  let arrive!: (browser: IClosableBrowser) => unknown;
  const launch = new Promise<IClosableBrowser>(resolve => {
    arrive = resolve;
  });
  return { launch, arrive };
}

/**
 * Yield until queued promise callbacks have run.
 *
 * @returns Resolves on the next macrotask tick.
 */
function flushPendingCallbacks(): Promise<unknown> {
  return new Promise(resolve => {
    setImmediate(resolve);
  });
}

/**
 * Run a launch that is guaranteed to exceed its bound.
 *
 * @returns The settled expectation that the bound rejected.
 */
function launchPastTheBound(): Promise<unknown> {
  const bounded = LAUNCH_CAMOUFOX(true);
  return expect(bounded).rejects.toThrow(/did not finish launching/);
}

/**
 * Build a close spy whose stubbed close resolves or rejects.
 *
 * <p>The outcome is constructed inside the mock so a rejection is only
 * created once close is actually invoked — an eagerly built rejected
 * promise would surface as an unhandled rejection before the code under
 * test consumes it.
 *
 * @param shouldFail - True to make close reject, mimicking a browser
 *   that has already exited.
 * @returns A jest mock usable as {@link IClosableBrowser.close}.
 */
function closeSpy(shouldFail: boolean): IClosableBrowser['close'] {
  return jest.fn((): Promise<unknown> => {
    if (shouldFail) return Promise.reject(new Error('already gone'));
    return Promise.resolve(true);
  });
}

/** Failure text of a broken stack check. */
const CHECK_FAILURE = 'stack check broke its never-reject contract';

/**
 * A stack check that rejects.
 *
 * @returns A rejected check result.
 */
function rejectingCheck(): Promise<number> {
  return Promise.reject(new ScraperError(CHECK_FAILURE));
}

/**
 * A stack check that throws before returning a promise.
 *
 * @returns Never; it throws.
 */
function throwingCheck(): Promise<number> {
  throw new ScraperError(CHECK_FAILURE);
}

/**
 * Launch with a stack check that fails, and report what the caller got.
 *
 * @param failingCheck - The check implementation for this launch.
 * @returns The browser handed back plus its close spy.
 */
async function launchWithFailingCheck(
  failingCheck: () => Promise<number>,
): Promise<{ browser: unknown; close: IClosableBrowser['close'] }> {
  STACK_CHECK_MOCK.mockImplementationOnce(failingCheck);
  const close = closeSpy(false);
  const launched = Promise.resolve({ close });
  CAMOUFOX_MOCK.mockReturnValue(launched);
  const browser = await LAUNCH_CAMOUFOX(true);
  await flushPendingCallbacks();
  return { browser, close };
}

describe('CamoufoxLauncher abandoned-launch disposal', () => {
  beforeEach(() => {
    process.env[CAMOUFOX_LAUNCH_TIMEOUT_ENV] = '5';
    CAMOUFOX_MOCK.mockReset();
    STACK_CHECK_MOCK.mockClear();
  });

  afterEach(() => {
    Reflect.deleteProperty(process.env, CAMOUFOX_LAUNCH_TIMEOUT_ENV);
  });

  it('closes a browser that arrives after the bound elapsed', async () => {
    const deferred = deferLaunch();
    CAMOUFOX_MOCK.mockReturnValue(deferred.launch);
    const close = closeSpy(false);
    await launchPastTheBound();
    deferred.arrive({ close });
    await flushPendingCallbacks();
    expect(close).toHaveBeenCalledTimes(1);
    expect(STACK_CHECK_MOCK).not.toHaveBeenCalled();
  });

  it('swallows a close failure rather than raising unhandled', async () => {
    const deferred = deferLaunch();
    CAMOUFOX_MOCK.mockReturnValue(deferred.launch);
    const close = closeSpy(true);
    await launchPastTheBound();
    deferred.arrive({ close });
    await flushPendingCallbacks();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('never closes the browser it hands back on the success path', async () => {
    const close = closeSpy(false);
    const launched = Promise.resolve({ close });
    CAMOUFOX_MOCK.mockReturnValue(launched);
    const browser = await LAUNCH_CAMOUFOX(true);
    await flushPendingCallbacks();
    expect(browser).toEqual({ close });
    expect(close).not.toHaveBeenCalled();
    expect(STACK_CHECK_MOCK).toHaveBeenCalledTimes(1);
  });

  it('runs the stack check only after the browser arrived', async () => {
    const deferred = deferLaunch();
    CAMOUFOX_MOCK.mockReturnValue(deferred.launch);
    process.env[CAMOUFOX_LAUNCH_TIMEOUT_ENV] = '60000';
    const launching = LAUNCH_CAMOUFOX(true);
    await flushPendingCallbacks();
    expect(STACK_CHECK_MOCK).not.toHaveBeenCalled();
    const close = closeSpy(false);
    deferred.arrive({ close });
    await launching;
    expect(STACK_CHECK_MOCK).toHaveBeenCalledTimes(1);
  });

  it('hands back the browser when the stack check rejects', async () => {
    const { browser, close } = await launchWithFailingCheck(rejectingCheck);
    expect(browser).toEqual({ close });
    expect(close).not.toHaveBeenCalled();
  });

  it('hands back the browser when the stack check throws synchronously', async () => {
    const { browser, close } = await launchWithFailingCheck(throwingCheck);
    expect(browser).toEqual({ close });
    expect(close).not.toHaveBeenCalled();
  });
});
