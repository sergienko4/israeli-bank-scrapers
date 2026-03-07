import { type Frame, type Page } from 'playwright';

import type { IDoneResult } from '../Interfaces/Common/StepResult';
import type { IWaitForRedirectOptions } from '../Interfaces/Common/WaitForRedirectOptions';
import type { IWaitForUrlOptions } from '../Interfaces/Common/WaitForUrlOptions';
import type { WaitUntilState } from '../Interfaces/Common/WaitUntilState';
import { getDebug } from './Debug';
import { waitUntil } from './Waiting';

export type { IWaitForRedirectOptions } from '../Interfaces/Common/WaitForRedirectOptions';
export type { IWaitForUrlOptions } from '../Interfaces/Common/WaitForUrlOptions';
export type { WaitUntilState } from '../Interfaces/Common/WaitUntilState';

const LOG = getDebug('navigation');

interface IWaitForOptions {
  waitUntil?: WaitUntilState;
  timeout?: number;
}

/**
 * Waits for any URL change on the page or frame, effectively waiting for a navigation event.
 *
 * @param pageOrFrame - the Playwright Page or Frame to monitor
 * @param options - optional Playwright wait options including waitUntil state and timeout
 * @returns a done result indicating navigation completed
 */
export async function waitForNavigation(
  pageOrFrame: Page | Frame,
  options?: IWaitForOptions,
): Promise<IDoneResult> {
  await pageOrFrame.waitForURL('**', options);
  return { done: true };
}

/**
 * Waits for a navigation event and ensures the DOM content is fully loaded before resolving.
 *
 * @param page - the Playwright Page to wait on
 * @returns a done result indicating navigation and DOM load completed
 */
export async function waitForNavigationAndDomLoad(page: Page): Promise<IDoneResult> {
  await waitForNavigation(page, { waitUntil: 'domcontentloaded' });
  return { done: true };
}

/**
 * Returns the current URL of the page or frame. When isClientSide is true, retrieves the URL
 * via window.location.href inside the browser context to capture SPA client-side routing state.
 *
 * @param pageOrFrame - the Playwright Page or Frame to read the URL from
 * @param isClientSide - when true, evaluates window.location.href in the browser context
 * @returns the current URL as a string, or a Promise resolving to the URL for client-side mode
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
 * Attempts to retrieve the current page URL without throwing; returns '?' on any error.
 * Used in log messages where the URL is diagnostic and a failure must not mask the real error.
 *
 * @param pageOrFrame - the Playwright Page or Frame to read the URL from
 * @param isClientSide - when true, evaluates window.location.href in the browser context
 * @returns the current URL string, or '?' if reading the URL fails
 */
async function safeGetUrl(pageOrFrame: Page | Frame, isClientSide: boolean): Promise<string> {
  try {
    return await getCurrentUrl(pageOrFrame, isClientSide);
  } catch {
    return '?';
  }
}

/**
 * Polls the page URL until it changes away from the initial value and is not on the ignore list.
 *
 * @param pageOrFrame - the Playwright Page or Frame to monitor
 * @param initial - the starting URL to detect a departure from
 * @param opts - polling options including isClientSide flag, ignored URLs, and timeout in ms
 * @param opts.isClientSide - when true, reads URL via window.location.href in browser context
 * @param opts.ignoreList - URLs that should not count as a redirect destination
 * @param opts.timeout - maximum wait time in milliseconds before throwing
 * @returns a done result indicating the redirect was detected
 */
async function pollForRedirect(
  pageOrFrame: Page | Frame,
  initial: string,
  opts: { isClientSide: boolean; ignoreList: string[]; timeout: number },
): Promise<IDoneResult> {
  await waitUntil(
    async () => {
      const current = await getCurrentUrl(pageOrFrame, opts.isClientSide);
      return current !== initial && !opts.ignoreList.includes(current);
    },
    `waiting for redirect from ${initial}`,
    { timeout: opts.timeout, interval: 1000 },
  );
  return { done: true };
}

/**
 * Waits for the page to navigate away from its current URL, logging the before and after URLs.
 * Throws when no redirect occurs within the timeout.
 *
 * @param pageOrFrame - the Playwright Page or Frame to monitor for navigation
 * @param opts - options including timeout, client-side URL mode, and list of URLs to skip
 * @returns a done result indicating the redirect was detected
 */
export async function waitForRedirect(
  pageOrFrame: Page | Frame,
  opts: IWaitForRedirectOptions = {},
): Promise<IDoneResult> {
  const { timeout = 20000, isClientSide = false, ignoreList = [] } = opts;
  const initial = await getCurrentUrl(pageOrFrame, isClientSide);
  LOG.info('waitForRedirect from %s', initial);
  try {
    await pollForRedirect(pageOrFrame, initial, { isClientSide, ignoreList, timeout });
  } catch (e) {
    LOG.info(
      'waitForRedirect TIMEOUT (%dms) — still at %s',
      timeout,
      await safeGetUrl(pageOrFrame, isClientSide),
    );
    throw e;
  }
  LOG.info('waitForRedirect → %s', await safeGetUrl(pageOrFrame, isClientSide));
  return { done: true };
}

/**
 * Polls the page URL until it matches the given exact string or regular expression.
 *
 * @param pageOrFrame - the Playwright Page or Frame to monitor
 * @param url - the expected URL as an exact string or a matching RegExp
 * @param opts - polling options including timeout in ms and client-side URL mode flag
 * @param opts.timeout - maximum wait time in milliseconds before throwing
 * @param opts.isClientSide - when true, reads URL via window.location.href in browser context
 * @returns a done result indicating the URL matched
 */
async function pollForUrl(
  pageOrFrame: Page | Frame,
  url: string | RegExp,
  opts: { timeout: number; isClientSide: boolean },
): Promise<IDoneResult> {
  await waitUntil(
    async () => {
      const current = await getCurrentUrl(pageOrFrame, opts.isClientSide);
      return url instanceof RegExp ? url.test(current) : url === current;
    },
    `waiting for url to be ${String(url)}`,
    { timeout: opts.timeout, interval: 1000 },
  );
  return { done: true };
}

/**
 * Waits until the current page URL matches the given exact string or regular expression.
 * Logs the stuck URL on timeout before rethrowing the error.
 *
 * @param pageOrFrame - the Playwright Page or Frame to monitor
 * @param url - the expected URL as an exact string or a matching RegExp
 * @param opts - options including timeout in ms and client-side URL mode flag
 * @returns a done result indicating the URL matched
 */
export async function waitForUrl(
  pageOrFrame: Page | Frame,
  url: string | RegExp,
  opts: IWaitForUrlOptions = {},
): Promise<IDoneResult> {
  const { timeout = 20000, isClientSide = false } = opts;
  try {
    await pollForUrl(pageOrFrame, url, { timeout, isClientSide });
  } catch (e) {
    const stuck = await safeGetUrl(pageOrFrame, isClientSide);
    LOG.info('waitForUrl TIMEOUT (%dms) pattern=%s at %s', timeout, url, stuck);
    throw e;
  }
  return { done: true };
}
