import { type Frame, type Page } from 'playwright';

import { getDebug } from '../../Common/Debug';
import { type WaitUntilState } from '../../Common/Navigation';
import { extractCredentialKey } from '../../Common/SelectorResolver';
import { sleep } from '../../Common/Waiting';
import { ScraperErrorTypes } from './Errors';
import { type ScraperScrapingResult } from './Interface';
import { type FieldConfig } from './LoginConfig';
import { ScraperWebsiteChangedError } from './ScraperWebsiteChangedError';

const LOG = getDebug('base-scraper-with-browser');

export type LoginCondition = string | RegExp | ((options?: { page?: Page }) => Promise<boolean>);

enum LoginBaseResults {
  Success = 'SUCCESS',
  UnknownError = 'UNKNOWN_ERROR',
}

const {
  Timeout: TIMEOUT,
  Generic: GENERIC,
  WafBlocked: WAF_BLOCKED,
  ...LOGIN_BASE_ENTRIES
} = ScraperErrorTypes;
void [TIMEOUT, GENERIC, WAF_BLOCKED]; // excluded from LOGIN_RESULTS — handled by BaseScraper

export const LOGIN_RESULTS = {
  ...LOGIN_BASE_ENTRIES,
  ...LoginBaseResults,
};

export type LoginResults =
  | Exclude<
      ScraperErrorTypes,
      ScraperErrorTypes.Timeout | ScraperErrorTypes.Generic | ScraperErrorTypes.WafBlocked
    >
  | LoginBaseResults;

export type PossibleLoginResults = Partial<Record<LoginResults, LoginCondition[]>>;

export interface LoginOptions {
  loginUrl: string;
  checkReadiness?: () => Promise<void>;
  fields: { selector: string; value: string; credentialKey?: string }[];
  submitButtonSelector: string | (() => Promise<void>);
  preAction?: () => Promise<Frame | undefined>;
  postAction?: () => Promise<void>;
  possibleResults: PossibleLoginResults;
  waitUntil?: WaitUntilState;
}

/**
 * Tests whether a single login condition matches the given URL or page state.
 *
 * @param condition - a string, regex, or async predicate to test against the current page
 * @param value - the current page URL to match against string/regex conditions
 * @param page - the Playwright page, passed to function-type conditions
 * @returns true if the condition matches
 */
async function testCondition(
  condition: LoginCondition,
  value: string,
  page: Page,
): Promise<boolean> {
  if (condition instanceof RegExp) return condition.test(value);
  if (typeof condition === 'function') return condition({ page });
  return value.toLowerCase() === condition.toLowerCase();
}

/**
 * Returns true if any of the given login conditions match the current page URL or state.
 *
 * @param conditions - the list of conditions to check
 * @param value - the URL string to test against string/regex conditions
 * @param page - the Playwright page, passed to function-type conditions
 * @returns true if at least one condition matches
 */
export async function matchesAnyCondition(
  conditions: LoginCondition[],
  value: string,
  page: Page,
): Promise<boolean> {
  const initialFalse = Promise.resolve(false);
  return conditions.reduce(async (acc, condition) => {
    const wasPreviouslyMatched = await acc;
    const isCurrentMatch = await testCondition(condition, value, page);
    return wasPreviouslyMatched || isCurrentMatch;
  }, initialFalse);
}

/**
 * Creates a generic scraping error result.
 *
 * @returns a failed ScraperScrapingResult with a Generic error type
 */
export function createGeneralError(): ScraperScrapingResult {
  return { success: false, errorType: ScraperErrorTypes.Generic };
}

/**
 * Runs a cleanup function and suppresses any thrown errors.
 *
 * @param cleanup - an async cleanup function to call safely
 */
export async function safeCleanup(cleanup: () => Promise<void>): Promise<void> {
  try {
    await cleanup();
  } catch (e) {
    LOG.info(`Cleanup function failed: ${(e as Error).message}`);
  }
}

/**
 * Finds the login result key whose conditions match the current page URL.
 *
 * @param object - map of login result keys to their matching conditions
 * @param value - the current page URL to test against
 * @param page - the Playwright page instance
 * @returns the matched LoginResults key, or UnknownError if no conditions matched
 */
export async function getKeyByValue(
  object: PossibleLoginResults,
  value: string,
  page: Page,
): Promise<LoginResults> {
  const keys = Object.keys(object) as LoginResults[];
  const noMatchYet = Promise.resolve<LoginResults | null>(null);
  const matched = await keys.reduce(async (acc, key) => {
    const prev = await acc;
    if (prev !== null) return prev;
    const conditions = object[key];
    if (!conditions) return null;
    const isAnyConditionMatched = await matchesAnyCondition(conditions, value, page);
    return isAnyConditionMatched ? key : null;
  }, noMatchYet);
  const currentUrl = page.url();
  if (!matched) LOG.info('no login result matched — url: %s, value: %s', currentUrl, value);
  return matched ?? LOGIN_RESULTS.UnknownError;
}

/**
 * Checks whether the browser is already on a known post-login result URL.
 *
 * @param possibleResults - the map of login result conditions
 * @param page - the current Playwright page
 * @returns true if the current URL matches any known success/failure result
 */
export async function alreadyAtResultUrl(
  possibleResults: PossibleLoginResults,
  page: Page,
): Promise<boolean> {
  try {
    const currentPageUrl = page.url();
    const isResult = await getKeyByValue(possibleResults, currentPageUrl, page);
    return isResult !== LOGIN_RESULTS.UnknownError;
  } catch {
    return false;
  }
}

/**
 * Generic fallback: detects invalid credentials via aria-invalid on login inputs.
 * Called when possibleResults.invalidPassword didn't match (stale selector / changed site).
 * Works for any Angular/React/HTML5 form — no bank-specific config needed.
 *
 * @param page - the Playwright page to inspect for aria-invalid inputs
 * @returns true if any login input has aria-invalid="true"
 */
export async function detectGenericInvalidPassword(page: Page): Promise<boolean> {
  try {
    return (await page.locator('input[aria-invalid="true"]').count()) > 0;
  } catch {
    return false;
  }
}

const MAX_403_RETRIES = 2;

export interface RetryOn403Opts {
  page: Page;
  url: string;
  waitUntil: WaitUntilState | undefined;
}

/**
 * Navigates to the URL from opts after a fixed delay, used as a 403 retry back-off.
 *
 * @param opts - navigation options containing page, url, and waitUntil state
 * @param attempt - the current retry attempt index (0-based)
 * @returns the HTTP status code of the navigation response
 */
async function navigateWithDelay(opts: RetryOn403Opts, attempt: number): Promise<number> {
  const delayMs = 15_000;
  LOG.info(
    'WAF 403 on %s, retry %d/%d after %ds',
    opts.url,
    attempt + 1,
    MAX_403_RETRIES,
    delayMs / 1000,
  );
  await sleep(delayMs);
  return (await opts.page.goto(opts.url, { waitUntil: opts.waitUntil }))?.status() ?? 0;
}

/**
 * Retries navigation when the server responds with HTTP 403, up to MAX_403_RETRIES times.
 *
 * @param opts - navigation options with page, url, and waitUntil state
 * @param attempt - the current retry attempt (starts at 0)
 * @returns a promise that resolves when navigation succeeds or throws after max retries
 */
export async function retryOn403(opts: RetryOn403Opts, attempt = 0): Promise<void> {
  if (attempt >= MAX_403_RETRIES)
    throw new ScraperWebsiteChangedError(
      'BaseScraperWithBrowser',
      `Failed: 403 on ${opts.url} (after ${String(MAX_403_RETRIES)} retries)`,
    );
  const status = await navigateWithDelay(opts, attempt);
  if (status === 200 || (status >= 300 && status < 400)) {
    LOG.info('WAF 403 resolved after retry %d', attempt + 1);
    return;
  }
  return retryOn403(opts, attempt + 1);
}

/**
 * Determines whether the browser is still showing the login page after a submit attempt.
 *
 * @param currentUrl - the URL the browser is currently on
 * @param loginUrl - the original login page URL
 * @returns true if the browser appears to still be on the login page
 */
export function isStuckOnLoginPage(currentUrl: string, loginUrl: string): boolean {
  return currentUrl === loginUrl || currentUrl === `${loginUrl}/` || currentUrl.includes('/login');
}

/**
 * Headless-only Chromium args: SwiftShader WebGL + remove automation signal.
 *
 * @param isHeadless - whether the browser is running in headless mode
 * @returns the list of extra Chromium command-line arguments for headless mode
 */
export function buildHeadlessArgs(isHeadless: boolean): string[] {
  if (!isHeadless) return [];
  return [
    '--use-gl=swiftshader',
    '--use-angle=swiftshader',
    '--disable-blink-features=AutomationControlled',
  ];
}

/**
 * Converts a raw field descriptor to a FieldConfig with a resolved credentialKey.
 *
 * @param field - the raw field descriptor
 * @param field.selector - CSS selector for the input element
 * @param field.credentialKey - optional override; derived from selector if omitted
 * @returns a FieldConfig ready for use with the SelectorResolver
 */
export function buildFieldConfig(field: { selector: string; credentialKey?: string }): FieldConfig {
  const key = field.credentialKey ?? extractCredentialKey(field.selector);
  return { credentialKey: key, selectors: [{ kind: 'css', value: field.selector }] };
}
