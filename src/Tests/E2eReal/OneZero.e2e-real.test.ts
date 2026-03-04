import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

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

const hasCredentials = !!(process.env.ONEZERO_EMAIL && process.env.ONEZERO_PASSWORD);
const describeIf = hasCredentials ? describe : describe.skip;
// Full scrape requires long-term OTP token — skip unless ONEZERO_OTP_LONG_TERM_TOKEN is set
const itIfToken = process.env.ONEZERO_OTP_LONG_TERM_TOKEN ? it : it.skip;

/** Save the long-term token back to .env so the next run can reuse it. */
function persistLongTermToken(token: string): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const envContent = fs.readFileSync(envPath, 'utf8');
  const updated = envContent.includes('ONEZERO_OTP_LONG_TERM_TOKEN=')
    ? envContent.replace(/ONEZERO_OTP_LONG_TERM_TOKEN=.*/m, `ONEZERO_OTP_LONG_TERM_TOKEN=${token}`)
    : `${envContent}\nONEZERO_OTP_LONG_TERM_TOKEN=${token}`;
  fs.writeFileSync(envPath, updated, 'utf8');
}

describeIf('E2E: OneZero (real credentials)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  itIfToken('scrapes transactions successfully (long-term token)', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.OneZero,
      startDate: lastMonthStartDate(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({
      email: process.env.ONEZERO_EMAIL ?? '',
      password: process.env.ONEZERO_PASSWORD ?? '',
      otpLongTermToken: process.env.ONEZERO_OTP_LONG_TERM_TOKEN ?? '',
    });

    if (result.success && 'longTermToken' in result && result.longTermToken) {
      persistLongTermToken(result.longTermToken as string);
    }

    assertSuccessfulScrape(result);
    logScrapedTransactions(result);
  });

  it('reaches OTP screen with valid credentials (no token)', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.OneZero,
      startDate: new Date(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
      otpCodeRetriever: () => Promise.resolve(''),
    });
    const result = await scraper.scrape({
      email: process.env.ONEZERO_EMAIL ?? '',
      password: process.env.ONEZERO_PASSWORD ?? '',
      phoneNumber: process.env.ONEZERO_PHONE_NUMBER ?? '',
      otpCodeRetriever: () => Promise.resolve(''),
    });
    expect(result.success).toBe(false);
    expect(result.errorType).not.toBe(ScraperErrorTypes.InvalidPassword);
  });

  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.OneZero,
      startDate: new Date(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({
      email: 'invalid@example.com',
      password: 'invalid123',
      otpCodeRetriever: () => Promise.resolve(''),
      phoneNumber: '+972500000000',
    });
    assertFailedLogin(result);
  });
});
