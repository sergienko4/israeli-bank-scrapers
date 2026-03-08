import { type Frame, type Page } from 'playwright';

import { getDebug } from '../../Common/Debug.js';
import { getCurrentUrl, type WaitUntilState } from '../../Common/Navigation.js';
import { ScraperProgressTypes } from '../../Definitions.js';
import { ScraperErrorTypes } from './Errors.js';
import { type ScraperScrapingResult } from './Interface.js';

const LOG = getDebug('base-scraper-with-browser');

type LoginConditionFn = (options?: { page?: Page }) => boolean | Promise<boolean>;
export type LoginCondition = string | RegExp | LoginConditionFn;

enum LoginBaseResults {
  Success = 'SUCCESS',
  UnknownError = 'UNKNOWN_ERROR',
}

const {
  Timeout: _TIMEOUT,
  Generic: _GENERIC,
  WafBlocked: _WAF_BLOCKED,
  ...LOGIN_BASE_ENTRIES
} = ScraperErrorTypes;

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

async function testCondition(
  condition: LoginCondition,
  value: string,
  page: Page,
): Promise<boolean> {
  if (condition instanceof RegExp) return condition.test(value);
  if (typeof condition === 'function') return condition({ page });
  return value.toLowerCase() === condition.toLowerCase();
}

export async function matchesAnyCondition(
  conditions: LoginCondition[],
  value: string,
  page: Page,
): Promise<boolean> {
  for (const condition of conditions) {
    if (await testCondition(condition, value, page)) return true;
  }
  return false;
}

export function createGeneralError(): ScraperScrapingResult {
  return { success: false, errorType: ScraperErrorTypes.Generic };
}

export async function safeCleanup(cleanup: () => Promise<void>): Promise<void> {
  try {
    await cleanup();
  } catch (e) {
    LOG.info(`Cleanup function failed: ${(e as Error).message}`);
  }
}

export async function getKeyByValue(
  object: PossibleLoginResults,
  value: string,
  page: Page,
): Promise<LoginResults> {
  const keys = Object.keys(object) as LoginResults[];
  for (const key of keys) {
    const conditions = object[key];
    if (!conditions) continue;
    if (await matchesAnyCondition(conditions, value, page)) return key;
  }
  LOG.info('no login result matched — url: %s, value: %s', page.url(), value);
  return LOGIN_RESULTS.UnknownError;
}

export async function alreadyAtResultUrl(
  possibleResults: PossibleLoginResults,
  page: Page,
): Promise<boolean> {
  try {
    const isResult = await getKeyByValue(possibleResults, page.url(), page);
    return isResult !== LOGIN_RESULTS.UnknownError;
  } catch {
    return false;
  }
}

/**
 * Generic fallback: detects invalid credentials via aria-invalid on login inputs.
 * Called when possibleResults.invalidPassword didn't match (stale selector / changed site).
 * Works for any Angular/React/HTML5 form — no bank-specific config needed.
 */
export async function detectGenericInvalidPassword(page: Page): Promise<boolean> {
  try {
    return (await page.locator('input[aria-invalid="true"]').count()) > 0;
  } catch {
    return false;
  }
}

export interface LoginResultContext {
  page: Page;
  diagState: { lastAction: string; finalUrl?: string; pageTitle?: string };
  emitProgress: (type: ScraperProgressTypes) => void;
}

function buildFailedResult(
  ctx: LoginResultContext,
  loginResult: LoginResults,
): ScraperScrapingResult {
  ctx.emitProgress(ScraperProgressTypes.LoginFailed);
  const errorType =
    loginResult === LOGIN_RESULTS.InvalidPassword
      ? ScraperErrorTypes.InvalidPassword
      : ScraperErrorTypes.Generic;
  const errorMessage = `Login failed with ${loginResult} error — url: ${ctx.page.url()}`;
  return { success: false, errorType, errorMessage };
}

export function buildLoginResult(
  ctx: LoginResultContext,
  loginResult: LoginResults,
): ScraperScrapingResult {
  ctx.diagState.lastAction = `login result: ${loginResult}`;
  LOG.info('login result=%s url=%s', loginResult, ctx.diagState.finalUrl ?? '?');
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

export async function resolveAndBuildLoginResult(
  ctx: LoginResultContext,
  possibleResults: PossibleLoginResults,
): Promise<ScraperScrapingResult> {
  const current = await getCurrentUrl(ctx.page, true);
  ctx.diagState.finalUrl = current;
  ctx.diagState.pageTitle = await ctx.page.title().catch(() => '');
  let result = await getKeyByValue(possibleResults, current, ctx.page);
  if (result === LOGIN_RESULTS.UnknownError && (await detectGenericInvalidPassword(ctx.page)))
    result = LOGIN_RESULTS.InvalidPassword;
  return buildLoginResult(ctx, result);
}
