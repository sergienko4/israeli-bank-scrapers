import { jest } from '@jest/globals';
import * as dotenv from 'dotenv';

import { CompanyTypes, createScraper } from '../../index.js';
import {
  BROWSER_ARGS,
  defaultStartDate,
  logScrapedTransactions,
  SCRAPE_TIMEOUT,
} from './Helpers.js';

dotenv.config();

const hasCredentials = !!(process.env.LEUMI_USERNAME && process.env.LEUMI_PASSWORD);
const DESCRIBE_IF = hasCredentials ? describe : describe.skip;

DESCRIBE_IF('E2E: Bank Leumi (real credentials)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('scrapes transactions successfully', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Leumi,
      startDate: defaultStartDate(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({
      username: process.env.LEUMI_USERNAME ?? '',
      password: process.env.LEUMI_PASSWORD ?? '',
    });

    // Diagnostic run: the only prod Leumi account is zero-balance /
    // zero-transaction, so we surface the full result shape (login,
    // accounts, balances) rather than assert non-zero txns. The
    // trace-level pipeline.log under C:\tmp\runs\pipeline\leumi\<stamp>
    // carries the per-phase WellKnown resolution detail.
    const accounts = result.accounts ?? [];
    const balances = accounts.map(a => ({
      acct: a.accountNumber,
      txns: a.txns.length,
      balance: a.balance,
    }));
    console.log(
      `[LEUMI-DIAG] success=${String(result.success)} errorType=${result.errorType ?? ''} ` +
        `errorMessage=${result.errorMessage ?? ''} accounts=${String(accounts.length)} ` +
        `balances=${JSON.stringify(balances)}`,
    );
    logScrapedTransactions(result);

    expect(result).toBeDefined();
  });
});
