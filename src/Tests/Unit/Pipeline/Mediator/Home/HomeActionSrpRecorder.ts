/**
 * Recording executor for HOME.ACTION SRP tests.
 *
 * Logs every `clickElement` and `navigateTo` call so tests can assert
 * exact call counts and selector shapes (identity vs raw text=). Lets
 * the test simulate post-click navigation by setting an `onClick`
 * callback that mutates the URL the executor reports.
 *
 * Targets `IActionMediator` (the sealed executor surface used by
 * `HomePhase.action` → `executeHomeNavigation`).
 */

import type { IActionMediator } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Args for `executor.clickElement` captured by the recorder. */
interface IClickRecord {
  readonly selector: string;
  readonly contextId: string;
  readonly isForce: boolean;
}

/** Args for `executor.navigateTo` captured by the recorder. */
interface INavigateRecord {
  readonly url: string;
}

/** Public surface of the recording executor helper. */
interface IRecordingExecutor {
  readonly executor: IActionMediator;
  readonly clickLog: readonly IClickRecord[];
  readonly navigateLog: readonly INavigateRecord[];
  /**
   * Force-set the URL the executor reports. Returns true so callers
   * can chain in arrow bodies without violating the no-void rule.
   */
  readonly setUrl: (url: string) => true;
  /**
   * Register a callback invoked synchronously after every recorded
   * click. Returns true for the same reason as `setUrl`.
   */
  readonly setOnClick: (cb: () => true) => true;
}

/** Args for `makeRecordingExecutor`. */
interface IRecorderArgs {
  /** Initial URL the executor reports. */
  readonly initialUrl: string;
  /** Optional href list returned by `collectAllHrefs`. */
  readonly hrefs?: readonly string[];
}

/** Click args bundled — fits the no-void / no-nested rule downstream. */
interface IClickInput {
  readonly contextId: string;
  readonly selector: string;
  readonly isForce?: boolean;
}

/**
 * Append a click record to `log` and return the always-true marker.
 * Extracted so the click handler stays inside the per-statement budget.
 * @param log - Mutable click log.
 * @param input - Click args from the production code.
 * @returns True after recording.
 */
function recordClick(log: IClickRecord[], input: IClickInput): true {
  log.push({
    selector: input.selector,
    contextId: input.contextId,
    isForce: input.isForce ?? false,
  });
  return true;
}

/**
 * Append a navigate record to `log` and return the always-true marker.
 * @param log - Mutable navigate log.
 * @param url - Target URL.
 * @returns True after recording.
 */
function recordNavigate(log: INavigateRecord[], url: string): true {
  log.push({ url });
  return true;
}

/** Bundled mutable state the recorder closes over. */
interface IRecorderState {
  readonly clickLog: IClickRecord[];
  readonly navigateLog: INavigateRecord[];
  readonly hrefs: readonly string[];
  url: string;
  onClick: (() => true) | false;
}

/**
 * Build the executor object — extracted so the public factory stays
 * small and lint-free.
 * @param state - Mutable recorder state.
 * @returns Sealed executor stub.
 */
function buildExecutor(state: IRecorderState): IActionMediator {
  return {
    /**
     * Record click + invoke the test-supplied onClick callback.
     * @param a - Click args.
     * @returns Resolved true.
     */
    clickElement: (a: IClickInput): Promise<true> => {
      const didRecord = recordClick(state.clickLog, a);
      const cb = state.onClick;
      if (cb) cb();
      return Promise.resolve(didRecord);
    },
    /**
     * Report current URL.
     * @returns Current URL string.
     */
    getCurrentUrl: (): string => state.url,
    /**
     * Stubbed network-idle wait — always succeeds.
     * @returns Resolved succeed(undefined).
     */
    waitForNetworkIdle: () => {
      const result = succeed(undefined);
      return Promise.resolve(result);
    },
    /**
     * Stubbed URL-pattern wait — never matches.
     * @returns Resolved succeed(false).
     */
    waitForURL: () => {
      const ok = succeed(false);
      return Promise.resolve(ok);
    },
    /**
     * Stubbed href list.
     * @returns Configured hrefs.
     */
    collectAllHrefs: (): Promise<readonly string[]> => Promise.resolve(state.hrefs),
    /**
     * Record navigate + change URL.
     * @param u - Target URL.
     * @returns Resolved succeed(undefined).
     */
    navigateTo: (u: string) => {
      recordNavigate(state.navigateLog, u);
      state.url = u;
      const ok = succeed(undefined);
      return Promise.resolve(ok);
    },
  } as unknown as IActionMediator;
}

/**
 * Build a recording executor. Every `clickElement` call appends to
 * `clickLog`; every `navigateTo` call appends to `navigateLog`. The
 * test can register an `onClick` callback to simulate URL change
 * after a click (so the post-click URL probe sees the new URL).
 * @param args - Recorder args.
 * @returns Recorder bundle.
 */
function makeRecordingExecutor(args: IRecorderArgs): IRecordingExecutor {
  const state: IRecorderState = {
    clickLog: [],
    navigateLog: [],
    hrefs: args.hrefs ?? [],
    url: args.initialUrl,
    onClick: false,
  };
  const executor = buildExecutor(state);
  /**
   * Set the URL the executor reports.
   * @param u - New URL.
   * @returns True.
   */
  const setUrl = (u: string): true => {
    state.url = u;
    return true;
  };
  /**
   * Register the post-click callback.
   * @param cb - Callback to fire on each click.
   * @returns True.
   */
  const setOnClick = (cb: () => true): true => {
    state.onClick = cb;
    return true;
  };
  return {
    executor,
    clickLog: state.clickLog,
    navigateLog: state.navigateLog,
    setUrl,
    setOnClick,
  };
}

export type { IRecordingExecutor };
export { makeRecordingExecutor };
