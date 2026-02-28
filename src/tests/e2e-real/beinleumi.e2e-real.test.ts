import * as dotenv from 'dotenv';
import * as readline from 'readline';
import { createScraper, CompanyTypes } from '../../index';
import { ScraperErrorTypes } from '../../scrapers/errors';
import { SCRAPE_TIMEOUT, BROWSER_ARGS, assertSuccessfulScrape, assertFailedLogin, lastMonthStartDate } from './helpers';

dotenv.config();

const hasCredentials = !!(process.env.BEINLEUMI_USERNAME && process.env.BEINLEUMI_PASSWORD);
const describeIf = hasCredentials ? describe : describe.skip;

/**
 * Prompts the user via stdin for the OTP code.
 * Falls back to BEINLEUMI_OTP env var if set (for CI use).
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
      resolve(code.trim());
    });
  });
}

describeIf('E2E: Beinleumi (real credentials)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('scrapes transactions successfully (OTP supported via stdin or BEINLEUMI_OTP env)', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.beinleumi,
      startDate: lastMonthStartDate(),
      showBrowser: false,
      args: BROWSER_ARGS,
      otpCodeRetriever: promptOtpCode,
    });
    const result = await scraper.scrape({
      username: process.env.BEINLEUMI_USERNAME!,
      password: process.env.BEINLEUMI_PASSWORD!,
    });
    assertSuccessfulScrape(result);
  });

  it('reaches OTP screen with valid credentials (no OTP retriever)', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.beinleumi,
      startDate: new Date(),
      showBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({
      username: process.env.BEINLEUMI_USERNAME!,
      password: process.env.BEINLEUMI_PASSWORD!,
    });
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.TwoFactorRetrieverMissing);
  });

  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.beinleumi,
      startDate: new Date(),
      showBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({ username: 'INVALID_USER', password: 'invalid123' });
    assertFailedLogin(result);
  });
});
