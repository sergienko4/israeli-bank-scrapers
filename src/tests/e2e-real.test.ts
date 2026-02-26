import * as dotenv from 'dotenv';
import { createScraper, CompanyTypes } from '../index';
import { LoginResults } from '../scrapers/base-scraper-with-browser';
import { ScraperErrorTypes } from '../scrapers/errors';
import type { ScraperScrapingResult } from '../scrapers/interface';

dotenv.config();

const SCRAPE_TIMEOUT = 120000;
const IS_CI = !!process.env.CI;
const BROWSER_ARGS = IS_CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : [];

const FAILED_LOGIN_TYPES: string[] = [
  LoginResults.InvalidPassword,
  LoginResults.UnknownError,
  ScraperErrorTypes.Generic,
  ScraperErrorTypes.General,
  ScraperErrorTypes.Timeout,
  ScraperErrorTypes.ChangePassword,
  ScraperErrorTypes.WafBlocked,
];

function hasAmexCredentials() {
  return !!(process.env.AMEX_ID && process.env.AMEX_CARD6DIGITS && process.env.AMEX_PASSWORD);
}

function hasVisaCalCredentials() {
  return !!(process.env.VISACAL_USERNAME && process.env.VISACAL_PASSWORD);
}

function hasDiscountCredentials() {
  return !!(process.env.DISCOUNT_ID && process.env.DISCOUNT_PASSWORD && process.env.DISCOUNT_NUM);
}

const describeIfAmex = hasAmexCredentials() ? describe : describe.skip;
const describeIfVisaCal = hasVisaCalCredentials() ? describe : describe.skip;
const describeIfDiscount = hasDiscountCredentials() ? describe : describe.skip;

function assertSuccessfulScrape(result: ScraperScrapingResult) {
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

function assertFailedLogin(result: ScraperScrapingResult) {
  expect(result.success).toBe(false);
  expect(FAILED_LOGIN_TYPES).toContain(result.errorType);
}

function lastMonthStartDate() {
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 1);
  return startDate;
}

describeIfAmex('E2E: Amex (real credentials)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('scrapes transactions successfully', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.amex,
      startDate: lastMonthStartDate(),
      showBrowser: false,
      args: BROWSER_ARGS,
    });

    const result = await scraper.scrape({
      id: process.env.AMEX_ID!,
      card6Digits: process.env.AMEX_CARD6DIGITS!,
      password: process.env.AMEX_PASSWORD!,
    });

    assertSuccessfulScrape(result);
  });

  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.amex,
      startDate: new Date(),
      showBrowser: false,
      args: BROWSER_ARGS,
    });

    const result = await scraper.scrape({
      id: '000000000',
      card6Digits: '000000',
      password: 'invalidpassword123',
    });

    assertFailedLogin(result);
  });
});

describeIfVisaCal('E2E: VisaCal (real credentials)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('scrapes transactions successfully', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.visaCal,
      startDate: lastMonthStartDate(),
      showBrowser: false,
      args: BROWSER_ARGS,
    });

    const result = await scraper.scrape({
      username: process.env.VISACAL_USERNAME!,
      password: process.env.VISACAL_PASSWORD!,
    });

    assertSuccessfulScrape(result);
  });

  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.visaCal,
      startDate: new Date(),
      showBrowser: false,
      args: BROWSER_ARGS,
    });

    const result = await scraper.scrape({
      username: 'INVALID_USER_XYZ',
      password: 'invalidpassword123',
    });

    assertFailedLogin(result);
  });
});

describeIfDiscount('E2E: Discount Bank (real credentials)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('scrapes transactions successfully', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.discount,
      startDate: lastMonthStartDate(),
      showBrowser: false,
      args: BROWSER_ARGS,
    });

    const result = await scraper.scrape({
      id: process.env.DISCOUNT_ID!,
      password: process.env.DISCOUNT_PASSWORD!,
      num: process.env.DISCOUNT_NUM!,
    });

    assertSuccessfulScrape(result);
  });

  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.discount,
      startDate: new Date(),
      showBrowser: false,
      args: BROWSER_ARGS,
    });

    const result = await scraper.scrape({
      id: '000000000',
      password: 'invalidpassword123',
      num: '000000',
    });

    assertFailedLogin(result);
  });
});
