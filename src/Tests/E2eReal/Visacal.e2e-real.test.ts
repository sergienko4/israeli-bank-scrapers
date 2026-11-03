import { jest } from '@jest/globals';
import * as dotenv from 'dotenv';

import { CompanyTypes, createScraper } from '../../index.js';
import type { IScraperScrapingResult, ScraperCredentials } from '../../Scrapers/Base/Interface.js';
import { INVALID_CREDS_USERNAME_PASSWORD } from '../TestConstants.js';
import { type IFetchPathWitness, installFetchPathWitness } from './FetchPathWitness.js';
import {
  assertFailedLogin,
  assertSuccessfulScrape,
  defaultStartDate,
  logScrapedTransactions,
  SCRAPE_TIMEOUT,
} from './Helpers.js';

dotenv.config();

const hasCredentials = !!(process.env.VISACAL_USERNAME && process.env.VISACAL_PASSWORD);

/**
 * Visa Cal logs in over the bank's API and opens no browser. A cold login
 * (password) returns a long-term hash on `persistentOtpToken`; a warm login
 * sends only that hash. The bank rotates the hash on every login, so each run
 * hands back a new token. Cal sends no SMS, so a rejected hash costs nothing:
 * the pipeline falls back to the password login by itself. The mocked suite
 * pins which login steps ran; this suite proves the real bank accepts both.
 */
const DESCRIBE_IF = hasCredentials ? describe : describe.skip;
const BIO_LOGIN_PATH = '/Authentication/api/login/bioLogin';
const REGULAR_LOGIN_PATH = '/Authentication/api/login/regularLogin';

/** Visa Cal's password credentials. */
interface ICalPasswordCreds {
  readonly username: string;
  readonly password: string;
}

/**
 * Run one Visa Cal scrape with a fresh scraper.
 * @param creds - Cold or warm credentials.
 * @returns The scrape result.
 */
function scrapeCal(creds: ScraperCredentials): Promise<IScraperScrapingResult> {
  const scraper = createScraper({ companyId: CompanyTypes.VisaCal, startDate: defaultStartDate() });
  return scraper.scrape(creds);
}

/**
 * Read the password credentials from the environment.
 * @returns Cold credentials.
 */
function coldCreds(): ICalPasswordCreds {
  const username = process.env.VISACAL_USERNAME ?? '';
  const password = process.env.VISACAL_PASSWORD ?? '';
  return { username, password };
}

/**
 * Verifies that every VisaCal account publishes a finite balance.
 * @param result - Successful scrape result.
 * @returns True when all balances are numeric.
 */
function assertNumericBalances(result: IScraperScrapingResult): true {
  const accounts = result.accounts ?? [];
  const isEveryBalanceFinite = accounts.every((account): boolean =>
    Number.isFinite(account.balance),
  );
  expect(isEveryBalanceFinite).toBe(true);
  return true;
}

/**
 * Assert a run succeeded and handed back a long-term token.
 * @param result - Scrape result.
 * @returns The returned token.
 */
function assertTokenReturned(result: IScraperScrapingResult): string {
  assertSuccessfulScrape(result);
  assertNumericBalances(result);
  const token = result.persistentOtpToken ?? '';
  expect(token.length).toBeGreaterThan(0);
  return token;
}

/** Cold-to-warm result plus the warm request paths. */
interface ICalColdWarmRun {
  readonly warm: IScraperScrapingResult;
  readonly coldToken: string;
  readonly warmToken: string;
  readonly warmPaths: readonly string[];
}

/**
 * Runs a cold scrape followed by its token-authenticated warm scrape.
 * @param witness - Path-only request witness.
 * @returns Both tokens, the warm result and warm-only request paths.
 */
async function scrapeColdThenWarm(witness: IFetchPathWitness): Promise<ICalColdWarmRun> {
  const creds = coldCreds();
  const coldToken = assertTokenReturned(await scrapeCal(creds));
  const checkpoint = witness.checkpoint();
  const warmCreds = { ...creds, otpLongTermToken: coldToken };
  const warm = await scrapeCal(warmCreds);
  const warmToken = assertTokenReturned(warm);
  const warmPaths = witness.pathsSince(checkpoint);
  return { warm, coldToken, warmToken, warmPaths };
}

/**
 * Verifies that a warm scrape used only the bank's hash-login path.
 * @param run - Cold-to-warm result.
 * @returns True when all warm-login assertions pass.
 */
function assertWarmRun(run: ICalColdWarmRun): boolean {
  expect(run.warmToken).not.toBe(run.coldToken);
  expect(run.warmPaths).toContain(BIO_LOGIN_PATH);
  expect(run.warmPaths).not.toContain(REGULAR_LOGIN_PATH);
  return true;
}

DESCRIBE_IF('E2E: VisaCal (real credentials, API-direct)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('E2E-CAL-WARM-1: scrapes transactions successfully without warm fallback', async () => {
    const witness = installFetchPathWitness();
    try {
      const run = await scrapeColdThenWarm(witness);
      assertWarmRun(run);
      logScrapedTransactions(run.warm);
    } finally {
      witness.dispose();
    }
  });

  it('fails with invalid credentials', async () => {
    const result = await scrapeCal(INVALID_CREDS_USERNAME_PASSWORD);
    assertFailedLogin(result);
  });
});
