import { type Page } from 'playwright';

import { getDebug } from '../../Common/Debug.js';
import { getCurrentUrl, type WaitUntilState } from '../../Common/Navigation.js';
import { runSerial } from '../../Common/Waiting.js';
import { ScraperProgressTypes } from '../../Definitions.js';
import { ScraperErrorTypes } from './Errors.js';
import { type IScraperScrapingResult } from './Interface.js';
import type { OptionalFramePromise } from './Interfaces/CallbackTypes.js';

const LOG = getDebug('base-scraper-with-browser');

/** A login condition: URL string, regex, or async predicate. */
type LoginConditionFn = (options?: { page?: Page }) => boolean | Promise<boolean>;

/** A login condition — URL string match, regex, or async predicate. */
export type LoginCondition = string | RegExp | LoginConditionFn;

/** Base login result types beyond the error types. */
enum LoginBaseResults {
  Success = 'SUCCESS',
  UnknownError = 'UNKNOWN_ERROR',
}

const {
  Timeout: EXCLUDED_TIMEOUT,
  Generic: EXCLUDED_GENERIC,
  WafBlocked: EXCLUDED_WAF_BLOCKED,
  ...LOGIN_BASE_ENTRIES
} = ScraperErrorTypes;
void EXCLUDED_TIMEOUT;
void EXCLUDED_GENERIC;
void EXCLUDED_WAF_BLOCKED;

/** Union of login result constants — excludes Timeout, Generic, and WafBlocked. */
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

/** Partial map from login result keys to condition arrays. */
export type PossibleLoginResults = Partial<Record<LoginResults, LoginCondition[]>>;

export interface ILoginOptions {
  loginUrl: string;
  checkReadiness?: () => Promise<boolean>;
  fields: { selector: string; value: string; credentialKey?: string }[];
  submitButtonSelector: string | (() => Promise<boolean>);
  preAction?: () => OptionalFramePromise;
  postAction?: () => Promise<boolean>;
  possibleResults: PossibleLoginResults;
  waitUntil?: WaitUntilState;
}

/**
 * Test a single login condition against the current URL/page.
 * @param condition - The condition to test.
 * @param value - The current URL or value to match against.
 * @param page - The Playwright page for function-type conditions.
 * @returns True if the condition matches.
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
 * Test whether any condition in the array matches the current URL.
 * @param conditions - The array of login conditions to test.
 * @param value - The current URL or value to match against.
 * @param page - The Playwright page for function-type conditions.
 * @returns True if any condition matches.
 */
export async function matchesAnyCondition(
  conditions: LoginCondition[],
  value: string,
  page: Page,
): Promise<boolean> {
  const actions = conditions.map(
    (condition): (() => Promise<boolean>) =>
      async () =>
        testCondition(condition, value, page),
  );
  const results = await runSerial(actions);
  return results.includes(true);
}

/**
 * Create a generic error scraping result.
 * @returns A failed scraping result with Generic error type.
 */
export function createGeneralError(): IScraperScrapingResult {
  return { success: false, errorType: ScraperErrorTypes.Generic };
}

/**
 * Run a cleanup function, swallowing errors to avoid masking earlier failures.
 * @param cleanup - The cleanup function to execute.
 * @returns True after the cleanup attempt completes.
 */
export async function safeCleanup(cleanup: () => Promise<boolean>): Promise<boolean> {
  try {
    await cleanup();
  } catch (e) {
    LOG.debug(`Cleanup function failed: ${(e as Error).message}`);
  }
  return true;
}

/** Context for testing login result conditions. */
interface IResultTestContext {
  object: PossibleLoginResults;
  value: string;
  page: Page;
}

/**
 * Test one result key against the current URL.
 * @param ctx - The result test context with map, URL, and page.
 * @param key - The result key to test.
 * @returns The key if it matches, or UnknownError as sentinel.
 */
async function testOneResultKey(ctx: IResultTestContext, key: LoginResults): Promise<LoginResults> {
  const conditions = ctx.object[key];
  if (!conditions) return LOGIN_RESULTS.UnknownError;
  const isMatch = await matchesAnyCondition(conditions, ctx.value, ctx.page);
  return isMatch ? key : LOGIN_RESULTS.UnknownError;
}

/**
 * Find the first matching login result key for the current page URL.
 * @param object - The possible login results map.
 * @param value - The current URL to match against.
 * @param page - The Playwright page for function-type conditions.
 * @returns The matched login result key, or UnknownError if none match.
 */
export async function getKeyByValue(
  object: PossibleLoginResults,
  value: string,
  page: Page,
): Promise<LoginResults> {
  const ctx: IResultTestContext = { object, value, page };
  const keys = Object.keys(object) as LoginResults[];
  const actions = keys.map(
    (key): (() => Promise<LoginResults>) =>
      () =>
        testOneResultKey(ctx, key),
  );
  const results = await runSerial(actions);
  const matched = results.find(r => r !== LOGIN_RESULTS.UnknownError);
  if (matched) return matched;
  const currentUrl = page.url();
  LOG.debug('no login result matched — url: %s, value: %s', currentUrl, value);
  return LOGIN_RESULTS.UnknownError;
}

/**
 * Check if the current page URL already matches a known login result.
 * @param possibleResults - The possible login results map.
 * @param page - The Playwright page to check.
 * @returns True if the URL matches a known result.
 */
export async function alreadyAtResultUrl(
  possibleResults: PossibleLoginResults,
  page: Page,
): Promise<boolean> {
  try {
    const currentUrl = page.url();
    const isResult = await getKeyByValue(possibleResults, currentUrl, page);
    return isResult !== LOGIN_RESULTS.UnknownError;
  } catch {
    return false;
  }
}

/**
 * Generic fallback: detects invalid credentials via aria-invalid on login inputs.
 * Called when possibleResults.invalidPassword didn't match (stale selector / changed site).
 * Works for any Angular/React/HTML5 form — no bank-specific config needed.
 * @param page - The Playwright page to inspect.
 * @returns True if any input has aria-invalid="true".
 */
export async function detectGenericInvalidPassword(page: Page): Promise<boolean> {
  try {
    return (await page.locator('input[aria-invalid="true"]').count()) > 0;
  } catch {
    return false;
  }
}

/** Context for building login results after navigation completes. */
export interface ILoginResultContext {
  page: Page;
  diagState: { lastAction: string; finalUrl?: string; pageTitle?: string };
  emitProgress: (type: ScraperProgressTypes) => boolean;
}

/**
 * Build a failed login scraping result with the appropriate error type.
 * @param ctx - The login result context.
 * @param loginResult - The login result key indicating the failure type.
 * @returns A failed scraping result.
 */
function buildFailedResult(
  ctx: ILoginResultContext,
  loginResult: LoginResults,
): IScraperScrapingResult {
  ctx.emitProgress(ScraperProgressTypes.LoginFailed);
  const errorType =
    loginResult === LOGIN_RESULTS.InvalidPassword
      ? ScraperErrorTypes.InvalidPassword
      : ScraperErrorTypes.Generic;
  const currentUrl = ctx.page.url();
  const errorMessage = `Login failed with ${loginResult} error — url: ${currentUrl}`;
  return { success: false, errorType, errorMessage };
}

/**
 * Build a scraping result from the resolved login result key.
 * @param ctx - The login result context with page and diagnostics.
 * @param loginResult - The resolved login result key.
 * @returns A scraping result indicating success or the specific failure.
 */
export function buildLoginResult(
  ctx: ILoginResultContext,
  loginResult: LoginResults,
): IScraperScrapingResult {
  ctx.diagState.lastAction = `login result: ${loginResult}`;
  LOG.debug('login result=%s url=%s', loginResult, ctx.diagState.finalUrl ?? '?');
  if (loginResult === LOGIN_RESULTS.Success) {
    ctx.emitProgress(ScraperProgressTypes.LoginSuccess);
    return { success: true };
  }
  if (loginResult === LOGIN_RESULTS.ChangePassword) {
    ctx.emitProgress(ScraperProgressTypes.ChangePassword);
    return { success: false, errorType: ScraperErrorTypes.ChangePassword };
  }
  return buildFailedResult(ctx, loginResult);
}

/**
 * Resolve the login result from the current page URL and build the result.
 * @param ctx - The login result context with page and diagnostics.
 * @param possibleResults - The possible login results map.
 * @returns The resolved scraping result.
 */
export async function resolveAndBuildLoginResult(
  ctx: ILoginResultContext,
  possibleResults: PossibleLoginResults,
): Promise<IScraperScrapingResult> {
  const current = await getCurrentUrl(ctx.page, true);
  ctx.diagState.finalUrl = current;
  ctx.diagState.pageTitle = await ctx.page.title().catch(() => '');
  let result = await getKeyByValue(possibleResults, current, ctx.page);
  const isInvalidPassword = await detectGenericInvalidPassword(ctx.page);
  if (result === LOGIN_RESULTS.UnknownError && isInvalidPassword)
    result = LOGIN_RESULTS.InvalidPassword;
  return buildLoginResult(ctx, result);
}
