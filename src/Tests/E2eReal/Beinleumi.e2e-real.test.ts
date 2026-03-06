import * as dotenv from 'dotenv';
import * as readline from 'readline';

import { CompanyTypes, createScraper } from '../../Index';
import { ScraperErrorTypes } from '../../Scrapers/Base/Errors';
import {
  assertFailedLogin,
  assertSuccessfulScrape,
  BROWSER_ARGS,
  lastMonthStartDate,
  logScrapedTransactions,
  SCRAPE_TIMEOUT,
} from './Helpers';

dotenv.config();

const hasCredentials = !!(process.env.BEINLEUMI_USERNAME && process.env.BEINLEUMI_PASSWORD);
const DESCRIBE_IF = hasCredentials ? describe : describe.skip;
// Full scrape requires OTP — skip in CI unless BEINLEUMI_OTP env var is provided
const IT_IF_OTP = process.env.BEINLEUMI_OTP ? it : it.skip;

/**
 * Prompts the user via stdin for the OTP code.
 * Falls back to BEINLEUMI_OTP env var if set (for CI use).
 *
 * @param phoneHint - masked phone number hint shown to the user
 * @returns the OTP code entered by the user or read from the env var
 */
async function promptOtpCode(phoneHint: string): Promise<string> {
  if (process.env.BEINLEUMI_OTP) {
    console.log(`[OTP] Using BEINLEUMI_OTP env var (hint: ${phoneHint || 'none'})`);
    return process.env.BEINLEUMI_OTP;
  }
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`\n[OTP] Enter the code sent to ${phoneHint || 'your phone'}: `, code => {
      rl.close();
      const trimmedCode = code.trim();
      resolve(trimmedCode);
    });
  });
}

DESCRIBE_IF('E2E: Beinleumi (real credentials)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  IT_IF_OTP(
    'scrapes transactions successfully (OTP supported via stdin or BEINLEUMI_OTP env)',
    async () => {
      const scraper = createScraper({
        companyId: CompanyTypes.Beinleumi,
        startDate: lastMonthStartDate(),
        shouldShowBrowser: false,
        args: BROWSER_ARGS,
        otpCodeRetriever: promptOtpCode,
      });
      const result = await scraper.scrape({
        username: process.env.BEINLEUMI_USERNAME ?? '',
        password: process.env.BEINLEUMI_PASSWORD ?? '',
      });

      assertSuccessfulScrape(result);
      logScrapedTransactions(result);
    },
  );

  it('reaches OTP screen with valid credentials (no OTP retriever)', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Beinleumi,
      startDate: new Date(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({
      username: process.env.BEINLEUMI_USERNAME ?? '',
      password: process.env.BEINLEUMI_PASSWORD ?? '',
    });
    expect(result.success).toBe(false);
    // TwoFactorRetrieverMissing = reached OTP screen (ideal case, non-Oracle IPs)
    // Generic = portal blocked by Oracle CI IPs (403) — credentials may still be valid
    expect(result.errorType).not.toBe(ScraperErrorTypes.InvalidPassword);
    expect([ScraperErrorTypes.TwoFactorRetrieverMissing, ScraperErrorTypes.Generic]).toContain(
      result.errorType,
    );
  });

  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Beinleumi,
      startDate: new Date(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({ username: 'INVALID_USER', password: 'invalid123' });
    assertFailedLogin(result);
  });
});
