/**
 * Unit tests for MonthlyScrapeFactory — generic monthly iteration pattern.
 * Tests createMonthlyScrapeFn: setup, month iteration, merge, rate limit, error handling.
 */

import moment from 'moment';

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import type { IMonthlyConfig } from '../../../../Scrapers/Pipeline/Phases/MonthlyScrapeFactory.js';
import { createMonthlyScrapeFn } from '../../../../Scrapers/Pipeline/Phases/MonthlyScrapeFactory.js';
import type { IPipelineContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { fail, isOk, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import type { ITransaction, ITransactionsAccount } from '../../../../Transactions.js';
import { TransactionStatuses, TransactionTypes } from '../../../../Transactions.js';
import { makeMockContext } from './MockFactories.js';

// ── Helpers ────────────────────────────────────────────────

/** Succeed with empty accounts — reusable in config callbacks. */
const EMPTY_ACCOUNTS = succeed<ITransactionsAccount[]>([]);

/** Succeed with true — reusable for setup callbacks. */
const SETUP_OK = succeed(true);

/**
 * Build a single mock transaction.
 * @returns ITransaction with default values.
 */
function makeTxn(): ITransaction {
  const txn: ITransaction = {
    type: TransactionTypes.Normal,
    date: '2024-06-01',
    processedDate: '2024-06-01',
    originalAmount: -100,
    originalCurrency: 'ILS',
    chargedAmount: -100,
    description: 'Test',
    status: TransactionStatuses.Completed,
  };
  return txn;
}

/**
 * Build a mock account for testing.
 * @param accountNumber - The account number.
 * @param txnCount - Number of mock transactions.
 * @returns ITransactionsAccount with txnCount transactions.
 */
function makeAccount(accountNumber: string, txnCount: number): ITransactionsAccount {
  const txns = Array.from({ length: txnCount }, makeTxn);
  const account: ITransactionsAccount = { accountNumber, balance: 0, txns };
  return account;
}

/**
 * Build a pipeline context with a start date for monthly range calculation.
 * @param monthsBack - How many months back from now for startDate.
 * @returns IPipelineContext with startDate set.
 */
function makeMonthlyCtx(monthsBack: number): IPipelineContext {
  const startDate = moment().subtract(monthsBack, 'months').toDate();
  return makeMockContext({
    options: {
      companyId: 'testBank',
      startDate,
    } as unknown as IPipelineContext['options'],
  });
}

// ── Tests ──────────────────────────────────────────────────

describe('createMonthlyScrapeFn', () => {
  it('calls fetchMonth for each month in range', async () => {
    const fetchedMonths: string[] = [];
    const config: IMonthlyConfig = {
      defaultMonthsBack: 2,
      rateLimitMs: 0,
      /**
       * Track which months are fetched.
       * @param _ctx - Pipeline context.
       * @param month - The month being fetched.
       * @returns Empty accounts.
       */
      getMonthTransactions: (_ctx, month) => {
        const formatted = month.format('YYYY-MM');
        fetchedMonths.push(formatted);
        return Promise.resolve(EMPTY_ACCOUNTS);
      },
    };

    const scrapeFn = createMonthlyScrapeFn(config);
    const ctx = makeMonthlyCtx(2);
    const result = await scrapeFn(ctx);

    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    expect(fetchedMonths.length).toBeGreaterThanOrEqual(2);
  });

  it('runs setup before fetching months', async () => {
    const callOrder: string[] = [];
    const config: IMonthlyConfig = {
      defaultMonthsBack: 1,
      rateLimitMs: 0,
      /**
       * Track setup call order.
       * @returns True.
       */
      setup: () => {
        callOrder.push('setup');
        return Promise.resolve(SETUP_OK);
      },
      /**
       * Track getMonthTransactions call order.
       * @returns Empty accounts.
       */
      getMonthTransactions: () => {
        callOrder.push('fetch');
        return Promise.resolve(EMPTY_ACCOUNTS);
      },
    };

    const scrapeFn = createMonthlyScrapeFn(config);
    const ctx = makeMonthlyCtx(1);
    await scrapeFn(ctx);

    expect(callOrder[0]).toBe('setup');
    const hasFetch = callOrder.some((c): boolean => c === 'fetch');
    expect(hasFetch).toBe(true);
  });

  it('returns failure when setup fails', async () => {
    const setupFailure = fail(ScraperErrorTypes.Generic, 'Setup failed');
    const config: IMonthlyConfig = {
      defaultMonthsBack: 1,
      rateLimitMs: 0,
      /**
       * Failing setup.
       * @returns Failure procedure.
       */
      setup: () => Promise.resolve(setupFailure),
      /**
       * Should not be called.
       * @returns Empty accounts.
       */
      getMonthTransactions: () => Promise.resolve(EMPTY_ACCOUNTS),
    };

    const scrapeFn = createMonthlyScrapeFn(config);
    const ctx = makeMonthlyCtx(1);
    const result = await scrapeFn(ctx);

    const isSuccess = isOk(result);
    expect(isSuccess).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('Setup failed');
    }
  });

  it('merges accounts with same accountNumber across months', async () => {
    let callCount = 0;
    const config: IMonthlyConfig = {
      defaultMonthsBack: 2,
      rateLimitMs: 0,
      /**
       * Return same account number each month with 1 txn.
       * @returns Single account with 1 transaction.
       */
      getMonthTransactions: () => {
        callCount += 1;
        const accounts = [makeAccount('1234', 1)];
        const ok = succeed(accounts);
        return Promise.resolve(ok);
      },
    };

    const scrapeFn = createMonthlyScrapeFn(config);
    const ctx = makeMonthlyCtx(2);
    const result = await scrapeFn(ctx);

    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (result.success) {
      const scrapeState = result.value.scrape;
      expect(scrapeState.has).toBe(true);
      if (scrapeState.has) {
        const accounts = scrapeState.value.accounts;
        // Should merge into single account with txns from multiple months
        expect(accounts.length).toBe(1);
        expect(accounts[0].accountNumber).toBe('1234');
        expect(accounts[0].txns.length).toBeGreaterThanOrEqual(callCount);
      }
    }
  });

  it('keeps separate accounts with different accountNumbers', async () => {
    const config: IMonthlyConfig = {
      defaultMonthsBack: 1,
      rateLimitMs: 0,
      /**
       * Return two accounts per month.
       * @returns Two accounts.
       */
      getMonthTransactions: () => {
        const acct1 = makeAccount('1111', 1);
        const acct2 = makeAccount('2222', 2);
        const ok = succeed([acct1, acct2]);
        return Promise.resolve(ok);
      },
    };

    const scrapeFn = createMonthlyScrapeFn(config);
    const ctx = makeMonthlyCtx(1);
    const result = await scrapeFn(ctx);

    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (result.success && result.value.scrape.has) {
      const accounts = result.value.scrape.value.accounts;
      expect(accounts.length).toBe(2);
    }
  });

  it('continues on month failure and accumulates warnings', async () => {
    let isFirstCall = true;
    const config: IMonthlyConfig = {
      defaultMonthsBack: 2,
      rateLimitMs: 0,
      /**
       * First month fails, second succeeds.
       * @returns Failure or accounts.
       */
      getMonthTransactions: () => {
        if (isFirstCall) {
          isFirstCall = false;
          const monthErr = fail(ScraperErrorTypes.Generic, 'Month failed');
          return Promise.resolve(monthErr);
        }
        const acct = makeAccount('9999', 1);
        const ok = succeed([acct]);
        return Promise.resolve(ok);
      },
    };

    const scrapeFn = createMonthlyScrapeFn(config);
    const ctx = makeMonthlyCtx(2);
    const result = await scrapeFn(ctx);

    // Should still succeed with partial data
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (result.success) {
      const hasWarnings = result.value.diagnostics.warnings.length > 0;
      expect(hasWarnings).toBe(true);
    }
  });

  it('populates scrape.accounts in the returned context', async () => {
    const config: IMonthlyConfig = {
      defaultMonthsBack: 1,
      rateLimitMs: 0,
      /**
       * Return one account.
       * @returns Single account.
       */
      getMonthTransactions: () => {
        const acct = makeAccount('5555', 3);
        const ok = succeed([acct]);
        return Promise.resolve(ok);
      },
    };

    const scrapeFn = createMonthlyScrapeFn(config);
    const ctx = makeMonthlyCtx(1);
    const result = await scrapeFn(ctx);

    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (result.success) {
      const hasScrape = result.value.scrape.has;
      expect(hasScrape).toBe(true);
      if (result.value.scrape.has) {
        expect(result.value.scrape.value.accounts.length).toBeGreaterThan(0);
      }
    }
  });
});
