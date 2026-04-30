/**
 * Shared mediator + executor factories for HomeActionsExtra split test files.
 */

import type {
  IActionMediator,
  IElementMediator,
  IRaceResult,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { ScraperLogger } from '../../../../../Scrapers/Pipeline/Types/Debug.js';
import { succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Silent logger for assertions. */
export const SILENT_LOG: ScraperLogger = {
  /**
   * debug.
   * @returns True.
   */
  debug: (): boolean => true,
  /**
   * trace.
   * @returns True.
   */
  trace: (): boolean => true,
  /**
   * info.
   * @returns True.
   */
  info: (): boolean => true,
  /**
   * warn.
   * @returns True.
   */
  warn: (): boolean => true,
  /**
   * error.
   * @returns True.
   */
  error: (): boolean => true,
} as unknown as ScraperLogger;

/**
 * Build a mediator stub for HomeActions testing.
 * @param opts - Stub behaviour.
 * @param opts.url - Script URL.
 * @param opts.visibleResult - Visible element resolution result.
 * @param opts.clickResult - Click action result.
 * @param opts.allHrefs - All href values encountered.
 * @param opts.idleSucc - Whether waitForNetworkIdle succeeded.
 * @returns Mock mediator.
 */
export function makeMediator(opts: {
  url?: string;
  visibleResult?: IRaceResult;
  clickResult?: IRaceResult;
  allHrefs?: readonly string[];
  idleSucc?: boolean;
}): IElementMediator {
  const visibleResult = opts.visibleResult ?? NOT_FOUND_RESULT;
  const clickResult = opts.clickResult ?? NOT_FOUND_RESULT;
  const allHrefs = opts.allHrefs ?? [];
  const didIdleSucceed = opts.idleSucc ?? true;
  let currentUrl = opts.url ?? 'https://bank.co.il';
  return {
    /**
     * getCurrentUrl.
     * @returns URL.
     */
    getCurrentUrl: (): string => currentUrl,
    /**
     * resolveVisible.
     * @returns Scripted visible result.
     */
    resolveVisible: (): Promise<IRaceResult> => Promise.resolve(visibleResult),
    /**
     * resolveAndClick.
     * @returns Procedure wrapping click result.
     */
    resolveAndClick: () => {
      const succeeded = succeed(clickResult);
      return Promise.resolve(succeeded);
    },
    /**
     * waitForNetworkIdle.
     * @returns Succeed/fail per flag.
     */
    waitForNetworkIdle: () => {
      const succeeded = didIdleSucceed ? succeed(undefined) : succeed(undefined);
      return Promise.resolve(succeeded);
    },
    /**
     * collectAllHrefs.
     * @returns Scripted hrefs.
     */
    collectAllHrefs: (): Promise<readonly string[]> => Promise.resolve(allHrefs),
    /**
     * navigateTo.
     * @param url - Nav URL.
     * @returns Succeed.
     */
    navigateTo: (url: string) => {
      currentUrl = url;
      const succeedResult1 = succeed(undefined);
      return Promise.resolve(succeedResult1);
    },
    /**
     * waitForURL.
     * @returns Succeed(false).
     */
    waitForURL: () => {
      const succeeded = succeed(false);
      return Promise.resolve(succeeded);
    },
  } as unknown as IElementMediator;
}

/**
 * Build a stub action mediator.
 * @param url - Parameter.
 * @returns Mock executor.
 */
export function makeExecutor(url = 'https://bank.co.il'): IActionMediator {
  let current = url;
  return {
    /**
     * clickElement.
     * @returns Resolved.
     */
    clickElement: (): Promise<true> => Promise.resolve(true),
    /**
     * waitForNetworkIdle.
     * @returns Succeed.
     */
    waitForNetworkIdle: () => {
      const succeeded = succeed(undefined);
      return Promise.resolve(succeeded);
    },
    /**
     * waitForURL.
     * @returns Succeed false.
     */
    waitForURL: () => {
      const succeeded = succeed(false);
      return Promise.resolve(succeeded);
    },
    /**
     * getCurrentUrl.
     * @returns Current.
     */
    getCurrentUrl: (): string => current,
    /**
     * collectAllHrefs.
     * @returns Empty.
     */
    collectAllHrefs: (): Promise<readonly string[]> => Promise.resolve([]),
    /**
     * navigateTo.
     * @param u - URL.
     * @returns Succeed.
     */
    navigateTo: (u: string) => {
      current = u;
      const succeedResult2 = succeed(undefined);
      return Promise.resolve(succeedResult2);
    },
  } as unknown as IActionMediator;
}
