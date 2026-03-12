import type { Page } from 'playwright';

import type { getDebug } from '../../Common/Debug.js';
import type { WaitUntilState } from '../../Common/Navigation.js';
import { MAX_403_RETRIES, WAF_RETRY_DELAY_MS } from './Config/LoginFlowConfig.js';
import ScraperError from './ScraperError.js';

/** Navigation options wrapping the optional Playwright waitUntil strategy. */
interface INavigationOpts {
  /** Playwright navigation wait strategy. */
  waitUntil?: WaitUntilState;
}

/** Callback signature for the recursive navigateTo retry function. */
type INavigateToFn = (url: string, navOpts: INavigationOpts, retries: number) => Promise<boolean>;

/** Parameters for a single navigation retry attempt. */
export interface INavigationRetryParams {
  /** The Playwright page to navigate. */
  page: Page;
  /** The URL that returned a non-OK status. */
  url: string;
  /** Playwright navigation wait strategy. */
  navOpts: INavigationOpts;
  /** The HTTP status code received. */
  status: number;
  /** Remaining non-403 retry attempts. */
  retries: number;
  /** Logger instance for debug output. */
  log: ReturnType<typeof getDebug>;
  /** Callback to perform a full navigateTo — retries with the same wait strategy. */
  navigateTo: INavigateToFn;
}

/**
 * Handle a non-OK navigation response with generic retry or 403 handling.
 * @param params - The navigation retry parameters.
 * @returns True when navigation eventually succeeds.
 */
export async function handleNavigationFailure(params: INavigationRetryParams): Promise<boolean> {
  const { url, navOpts, status, retries, log, page } = params;
  if (status === 403) return retryOn403({ page, url, navOpts, log, attempt: 0 });
  if (retries > 0) {
    log.debug('navigateTo %s → %d, retrying (%d left)', url, status, retries);
    return params.navigateTo(url, navOpts, retries - 1);
  }
  const statusStr = String(status);
  throw new ScraperError(`Failed to navigate to url ${url}, status code: ${statusStr}`);
}

/** Parameters for a single WAF 403 retry cycle. */
interface IWaf403Params {
  page: Page;
  url: string;
  navOpts: INavigationOpts;
  log: ReturnType<typeof getDebug>;
  attempt: number;
}

/**
 * Perform a single WAF 403 retry attempt with a fixed delay.
 * @param params - The WAF retry parameters.
 * @returns The HTTP status code returned by the retry request.
 */
async function navigateAfterDelay(params: IWaf403Params): Promise<number> {
  const { page, url, navOpts, log, attempt } = params;
  const delaySeconds = String(WAF_RETRY_DELAY_MS / 1000);
  const retryMsg = 'WAF 403 on %s, retry %d/%d after %ss';
  log.debug(retryMsg, url, attempt + 1, MAX_403_RETRIES, delaySeconds);
  await page.waitForTimeout(WAF_RETRY_DELAY_MS);
  const response = await page.goto(url, navOpts);
  return response?.status() ?? 0;
}

/**
 * Retry navigation on HTTP 403 with progressive attempts.
 * @param params - The WAF retry parameters including the current attempt.
 * @returns True when navigation eventually succeeds.
 */
async function retryOn403(params: IWaf403Params): Promise<boolean> {
  const { url, log, attempt } = params;
  if (attempt >= MAX_403_RETRIES) {
    const retriesStr = String(MAX_403_RETRIES);
    throw new ScraperError(`Failed to navigate to ${url}, 403 after ${retriesStr} retries`);
  }
  const status = await navigateAfterDelay(params);
  if (status === 200 || (status >= 300 && status < 400)) {
    log.debug('WAF 403 resolved after retry %d', attempt + 1);
    return true;
  }
  return retryOn403({ ...params, attempt: attempt + 1 });
}
