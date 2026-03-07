import { type Frame, type Page } from 'playwright';

import { getDebug } from '../../Common/Debug';
import { capturePageText } from '../../Common/ElementsInteractions';
import { type WaitUntilState } from '../../Common/Navigation';
import { extractCredentialKey } from '../../Common/SelectorResolver';
import { sleep } from '../../Common/Waiting';
import { type CompanyTypes } from '../../Definitions';
import type { FoundResult } from '../../Interfaces/Common/FoundResult';
import type { LoginStepResult } from '../../Interfaces/Common/LoginStepResult';
import type { IDoneResult } from '../../Interfaces/Common/StepResult';
import { getWafReturnUrls } from '../Registry/ScraperConfig';
import { ScraperErrorTypes } from './Errors';
import { type IScraperScrapingResult } from './Interface';
import { type IFieldConfig } from './LoginConfig';
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

export interface ILoginOptions {
  loginUrl: string;
  checkReadiness?: () => Promise<IDoneResult>;
  fields: { selector: string; value: string; credentialKey?: string }[];
  submitButtonSelector: string | (() => Promise<IDoneResult>);
  preAction?: () => Promise<FoundResult<Frame>>;
  postAction?: () => Promise<IDoneResult>;
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
 * @returns a failed IScraperScrapingResult with a Generic error type
 */
export function createGeneralError(): IScraperScrapingResult {
  return { success: false, errorType: ScraperErrorTypes.Generic };
}

/**
 * Runs a cleanup function and suppresses any thrown errors.
 *
 * @param cleanup - an async cleanup function to call safely
 * @returns a promise that resolves when cleanup is complete or suppressed
 */
export async function safeCleanup(cleanup: () => Promise<IDoneResult>): Promise<IDoneResult> {
  try {
    await cleanup();
  } catch (e) {
    LOG.info(`Cleanup function failed: ${(e as Error).message}`);
  }
  return { done: true };
}

/** Opts for a single reduce step in getKeyByValue. */
interface IReduceStepOpts {
  object: PossibleLoginResults;
  value: string;
  page: Page;
  noMatch: LoginResults;
}

/**
 * One step of the getKeyByValue reduce: returns the previous match or tests the current key.
 *
 * @param opts - reduce step options (lookup map, URL, page, sentinel value)
 * @param prev - the result of the previous step
 * @param key - the current LoginResults key to test
 * @returns the matched key, or the noMatch sentinel
 */
async function reduceStep(
  opts: IReduceStepOpts,
  prev: LoginResults,
  key: LoginResults,
): Promise<LoginResults> {
  if (prev !== opts.noMatch) return prev;
  const conditions = opts.object[key];
  if (!conditions) return opts.noMatch;
  const isMatched = await matchesAnyCondition(conditions, opts.value, opts.page);
  return isMatched ? key : opts.noMatch;
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
  const noMatch: LoginResults = LOGIN_RESULTS.UnknownError;
  const initialAcc: Promise<LoginResults> = Promise.resolve(noMatch);
  const opts: IReduceStepOpts = { object, value, page, noMatch };
  const result = await keys.reduce(
    (acc: Promise<LoginResults>, key: LoginResults) =>
      acc.then(prev => reduceStep(opts, prev, key)),
    initialAcc,
  );
  if (result === noMatch) {
    const currentUrl = page.url();
    LOG.info('no login result matched — url: %s, value: %s', currentUrl, value);
  }
  return result;
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
 * Detects invalid credentials using two complementary methods:
 * 1. aria-invalid="true" on login inputs (Angular/React/HTML5 forms — no config needed).
 * 2. Page-text scan: checks whether any pattern from wrongCredentialTexts appears in
 *    the first 2000 characters of body text (bank-specific Hebrew error messages).
 *
 * @param page - the Playwright page to inspect
 * @param wrongCredentialTexts - bank-specific Hebrew substrings that signal wrong credentials
 * @returns true if aria-invalid is present or any text pattern matches
 */
export async function detectGenericInvalidPassword(
  page: Page,
  wrongCredentialTexts: readonly string[] = [],
): Promise<boolean> {
  try {
    const hasAriaInvalid = (await page.locator('input[aria-invalid="true"]').count()) > 0;
    if (hasAriaInvalid) return true;
    if (wrongCredentialTexts.length === 0) return false;
    const pageText = await capturePageText(page);
    return wrongCredentialTexts.some(pattern => pageText.includes(pattern));
  } catch {
    return false;
  }
}

const MAX_403_RETRIES = 2;

export interface IRetryOn403Opts {
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
async function navigateWithDelay(opts: IRetryOn403Opts, attempt: number): Promise<number> {
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
export async function retryOn403(opts: IRetryOn403Opts, attempt = 0): Promise<IDoneResult> {
  if (attempt >= MAX_403_RETRIES)
    throw new ScraperWebsiteChangedError(
      'BaseScraperWithBrowser',
      `Failed: 403 on ${opts.url} (after ${String(MAX_403_RETRIES)} retries)`,
    );
  const status = await navigateWithDelay(opts, attempt);
  if (status === 200 || (status >= 300 && status < 400)) {
    LOG.info('WAF 403 resolved after retry %d', attempt + 1);
    return { done: true };
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
 * Converts a raw field descriptor to a IFieldConfig with a resolved credentialKey.
 *
 * @param field - the raw field descriptor
 * @param field.selector - CSS selector for the input element
 * @param field.credentialKey - optional override; derived from selector if omitted
 * @returns a IFieldConfig ready for use with the SelectorResolver
 */
export function buildFieldConfig(field: {
  selector: string;
  credentialKey?: string;
}): IFieldConfig {
  const key = field.credentialKey ?? extractCredentialKey(field.selector);
  return { credentialKey: key, selectors: [{ kind: 'css', value: field.selector }] };
}

/** Shared WafBlocked error result used by detectWafRedirect. */
const WAF_BLOCKED_RESULT: IScraperScrapingResult = {
  success: false,
  errorType: ScraperErrorTypes.WafBlocked,
  errorMessage: 'WAF redirect detected',
};

/**
 * Checks if the page URL matches a bank-configured WAF return URL pattern.
 * Returns WafBlocked immediately so the engine fallback chain can retry.
 * Returns shouldContinue:true when no WAF pattern matches.
 *
 * @param submitUrl - the page URL captured after the post-submit sleep
 * @param companyId - the bank company identifier
 * @returns LoginStepResult — shouldContinue: false + WafBlocked when WAF detected
 */
export function detectWafRedirect(submitUrl: string, companyId: CompanyTypes): LoginStepResult {
  const wafUrls = getWafReturnUrls(companyId);
  if (!wafUrls.some(p => submitUrl.includes(p))) return { shouldContinue: true };
  return { shouldContinue: false, result: WAF_BLOCKED_RESULT };
}
