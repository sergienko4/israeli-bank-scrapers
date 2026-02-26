import { LoginResults } from '../../scrapers/base-scraper-with-browser';
import { ScraperErrorTypes } from '../../scrapers/errors';
import type { ScraperScrapingResult } from '../../scrapers/interface';

export const SCRAPE_TIMEOUT = 120000;
export const IS_CI = !!process.env.CI;
export const BROWSER_ARGS = IS_CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : [];

const FAILED_LOGIN_TYPES: string[] = [
  LoginResults.InvalidPassword,
  LoginResults.UnknownError,
  ScraperErrorTypes.Generic,
  ScraperErrorTypes.General,
  ScraperErrorTypes.Timeout,
  ScraperErrorTypes.ChangePassword,
  ScraperErrorTypes.WafBlocked,
];

export function assertSuccessfulScrape(result: ScraperScrapingResult) {
  const error = `${result.errorType || ''} ${result.errorMessage || ''}`.trim();
  expect(error).toBe('');
  expect(result.success).toBe(true);
  expect(result.accounts).toBeDefined();
  expect(result.accounts!.length).toBeGreaterThan(0);
  for (const account of result.accounts!) {
    expect(account.accountNumber).toBeTruthy();
    expect(Array.isArray(account.txns)).toBe(true);
  }
}

export function assertFailedLogin(result: ScraperScrapingResult) {
  expect(result.success).toBe(false);
  expect(FAILED_LOGIN_TYPES).toContain(result.errorType);
}

export function lastMonthStartDate() {
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 1);
  return startDate;
}
