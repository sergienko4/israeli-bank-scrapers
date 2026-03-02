import * as dotenv from 'dotenv';
import * as readline from 'readline';

import { CompanyTypes, createScraper } from '../../index';
import {
  assertFailedLogin,
  assertSuccessfulScrape,
  BROWSER_ARGS,
  lastMonthStartDate,
  logScrapedTransactions,
  SCRAPE_TIMEOUT,
} from './Helpers';

dotenv.config();

const hasCredentials = !!(
  process.env.DISCOUNT_ID &&
  process.env.DISCOUNT_PASSWORD &&
  process.env.DISCOUNT_NUM
);
const describeIf = hasCredentials ? describe : describe.skip;

async function promptOtpCode(phoneHint: string): Promise<string> {
  if (process.env.DISCOUNT_OTP) {
    console.log(`[OTP] Using DISCOUNT_OTP env var (hint: ${phoneHint || 'none'})`);
    return process.env.DISCOUNT_OTP;
  }
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`\n[OTP] Enter the code sent to ${phoneHint || 'your phone'}: `, code => {
      rl.close();
      resolve(code.trim());
    });
  });
}

describeIf('E2E: Discount Bank (real credentials)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('scrapes transactions successfully (OTP supported via stdin or DISCOUNT_OTP env)', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Discount,
      startDate: lastMonthStartDate(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
      otpCodeRetriever: promptOtpCode,
    });
    const result = await scraper.scrape({
      id: process.env.DISCOUNT_ID!,
      password: process.env.DISCOUNT_PASSWORD!,
      num: process.env.DISCOUNT_NUM!,
    });
    assertSuccessfulScrape(result);
    logScrapedTransactions(result);
  });

  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Discount,
      startDate: new Date(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({ id: '000000000', password: 'invalid123', num: '000000' });
    assertFailedLogin(result);
  });
});
