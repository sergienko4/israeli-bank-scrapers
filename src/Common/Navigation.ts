import { type Frame, type Page } from 'playwright';

import { NAVIGATION_TIMEOUT_MS, URL_POLL_INTERVAL_MS } from './Config/NavigationConfig.js';
import { getDebug } from './Debug.js';
import { waitUntil } from './Waiting.js';

const LOG = getDebug('navigation');

export type WaitUntilState = 'load' | 'domcontentloaded' | 'networkidle' | 'commit';

interface IWaitForOptions {
  waitUntil?: WaitUntilState;
  timeout?: number;
}

/**
 * Wait for the current page navigation to complete.
 * @param pageOrFrame - The Playwright Page or Frame to wait on.
 * @param options - Optional wait configuration (waitUntil, timeout).
 * @returns True after navigation completes.
 */
export async function waitForNavigation(
  pageOrFrame: Page | Frame,
  options?: IWaitForOptions,
): Promise<boolean> {
  await pageOrFrame.waitForURL('**', options);
  return true;
}

/**
 * Wait for navigation with DOM content loaded.
 * @param page - The Playwright Page to wait on.
 * @returns True after DOM content is loaded.
 */
export async function waitForNavigationAndDomLoad(page: Page): Promise<boolean> {
  await waitForNavigation(page, { waitUntil: 'domcontentloaded' });
  return true;
}

/**
 * Get the current URL of a page or frame.
 * @param pageOrFrame - The Playwright Page or Frame to query.
 * @param isClientSide - Whether to use client-side evaluation.
 * @returns The current URL string.
 */
export function getCurrentUrl(
  pageOrFrame: Page | Frame,
  isClientSide = false,
): Promise<string> | string {
  if (isClientSide) {
    return pageOrFrame.evaluate(() => window.location.href);
  }

  return pageOrFrame.url();
}

/**
 * Get the current URL safely, returning '?' on failure.
 * @param pageOrFrame - The Playwright Page or Frame to query.
 * @param isClientSide - Whether to use client-side evaluation.
 * @returns The current URL or '?' on error.
 */
async function safeGetUrl(pageOrFrame: Page | Frame, isClientSide: boolean): Promise<string> {
  try {
    return await getCurrentUrl(pageOrFrame, isClientSide);
  } catch {
    return '?';
  }
}

/** Options for waiting for a URL redirect. */
export interface IWaitForRedirectOptions {
  timeout?: number;
  isClientSide?: boolean;
  ignoreList?: string[];
}

/** Internal options for redirect polling. */
interface IRedirectPollOpts {
  isClientSide: boolean;
  ignoreList: string[];
  timeout: number;
}

/**
 * Poll until the URL changes from the initial value.
 * @param pageOrFrame - The Playwright Page or Frame to poll.
 * @param initial - The initial URL to detect a change from.
 * @param opts - Polling configuration options.
 * @returns True when the URL has changed.
 */
async function pollForRedirect(
  pageOrFrame: Page | Frame,
  initial: string,
  opts: IRedirectPollOpts,
): Promise<boolean> {
  await waitUntil(
    async () => {
      const current = await getCurrentUrl(pageOrFrame, opts.isClientSide);
      return current !== initial && !opts.ignoreList.includes(current);
    },
    `waiting for redirect from ${initial}`,
    { timeout: opts.timeout, interval: URL_POLL_INTERVAL_MS },
  );
  return true;
}

/**
 * Wait for the page to redirect away from its current URL.
 * @param pageOrFrame - The Playwright Page or Frame to watch.
 * @param opts - Optional redirect wait configuration.
 * @returns True when redirect completes.
 */
export async function waitForRedirect(
  pageOrFrame: Page | Frame,
  opts: IWaitForRedirectOptions = {},
): Promise<boolean> {
  const { timeout = NAVIGATION_TIMEOUT_MS, isClientSide = false, ignoreList = [] } = opts;
  const initial = await getCurrentUrl(pageOrFrame, isClientSide);
  LOG.debug('waitForRedirect from %s', initial);
  try {
    await pollForRedirect(pageOrFrame, initial, { isClientSide, ignoreList, timeout });
  } catch (caught) {
    LOG.debug(
      'waitForRedirect TIMEOUT (%dms) — still at %s',
      timeout,
      await safeGetUrl(pageOrFrame, isClientSide),
    );
    throw caught;
  }
  LOG.debug('waitForRedirect → %s', await safeGetUrl(pageOrFrame, isClientSide));
  return true;
}

/** Options for waiting for a specific URL. */
export interface IWaitForUrlOptions {
  timeout?: number;
  isClientSide?: boolean;
}

/** Internal options for URL polling. */
interface IUrlPollOpts {
  timeout: number;
  isClientSide: boolean;
}

/**
 * Poll until the page URL matches the target pattern.
 * @param pageOrFrame - The Playwright Page or Frame to poll.
 * @param url - The target URL string or regex pattern.
 * @param opts - Polling configuration options.
 * @returns True when the URL matches.
 */
async function pollForUrl(
  pageOrFrame: Page | Frame,
  url: string | RegExp,
  opts: IUrlPollOpts,
): Promise<boolean> {
  const urlDescription = String(url);
  await waitUntil(
    async () => {
      const current = await getCurrentUrl(pageOrFrame, opts.isClientSide);
      return url instanceof RegExp ? url.test(current) : url === current;
    },
    `waiting for url to be ${urlDescription}`,
    { timeout: opts.timeout, interval: URL_POLL_INTERVAL_MS },
  );
  return true;
}

/**
 * Wait for the page URL to match a specific string or pattern.
 * @param pageOrFrame - The Playwright Page or Frame to watch.
 * @param url - The target URL string or regex pattern.
 * @param opts - Optional URL wait configuration.
 * @returns True when the URL matches.
 */
export async function waitForUrl(
  pageOrFrame: Page | Frame,
  url: string | RegExp,
  opts: IWaitForUrlOptions = {},
): Promise<boolean> {
  const { timeout = NAVIGATION_TIMEOUT_MS, isClientSide = false } = opts;
  try {
    await pollForUrl(pageOrFrame, url, { timeout, isClientSide });
  } catch (caught) {
    const stuck = await safeGetUrl(pageOrFrame, isClientSide);
    LOG.debug('waitForUrl TIMEOUT (%dms) pattern=%s at %s', timeout, url, stuck);
    throw caught;
  }
  return true;
}
