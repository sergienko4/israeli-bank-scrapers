import { LOGIN_RESULTS } from '../../Scrapers/BaseScraperWithBrowser';
import { ScraperErrorTypes } from '../../Scrapers/Errors';
import type { ScraperScrapingResult } from '../../Scrapers/Interface';

export const SCRAPE_TIMEOUT = 120000;
export const IS_CI = !!process.env.CI;
export const BROWSER_ARGS = IS_CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : [];

const FAILED_LOGIN_TYPES: string[] = [
  LOGIN_RESULTS.InvalidPassword,
  LOGIN_RESULTS.UnknownError,
  ScraperErrorTypes.Generic,
  ScraperErrorTypes.General,
  ScraperErrorTypes.Timeout,
  ScraperErrorTypes.ChangePassword,
  ScraperErrorTypes.WafBlocked,
  // Banks that require OTP can't complete login with invalid creds — valid failure
  ScraperErrorTypes.TwoFactorRetrieverMissing,
];

export function assertSuccessfulScrape(result: ScraperScrapingResult): void {
  const error = `${result.errorType || ''} ${result.errorMessage || ''}`.trim();
  expect(error).toBe('');
  expect(result.success).toBe(true);
  expect(result.accounts).toBeDefined();
  // accounts may legitimately be empty when no activity in the billing period
  for (const account of result.accounts!) {
    expect(account.accountNumber).toBeTruthy();
    expect(Array.isArray(account.txns)).toBe(true);
  }
}

export function assertFailedLogin(result: ScraperScrapingResult): void {
  expect(result.success).toBe(false);
  expect(FAILED_LOGIN_TYPES).toContain(result.errorType);
}

export function lastMonthStartDate(): Date {
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 1);
  return startDate;
}

const MAX_TXN_LOG = 10;

export function logScrapedTransactions(result: ScraperScrapingResult): void {
  if (!result.accounts) return;
  for (const account of result.accounts) {
    const preview = account.txns.slice(0, MAX_TXN_LOG);
    const rows = preview.map(t => {
      const date = t.date ? new Date(t.date).toLocaleDateString('he-IL') : '';
      const amt = t.originalAmount?.toFixed(2) ?? '';
      const cur = t.originalCurrency ?? '';
      const desc = (t.description ?? '').slice(0, 30);
      return `  ${date.padEnd(12)}${amt.padStart(10)} ${cur.padEnd(4)} ${desc}`;
    });
    const more =
      account.txns.length > MAX_TXN_LOG ? `  ... +${account.txns.length - MAX_TXN_LOG} more` : '';
    console.log(
      `\n--- Account ${account.accountNumber} | balance: ${account.balance ?? 'N/A'} | ${account.txns.length} txns ---\n${rows.join('\n')}${more ? `\n${more}` : ''}`,
    );
  }
}
