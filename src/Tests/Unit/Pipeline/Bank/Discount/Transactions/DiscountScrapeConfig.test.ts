/**
 * Unit tests for Discount scrape config — mappers and request builder.
 * Tests DISCOUNT_SCRAPE_CONFIG exported from DiscountPipeline.
 */

import { DISCOUNT_SCRAPE_CONFIG } from '../../../../../../Scrapers/Pipeline/Banks/Discount/DiscountPipeline.js';
import { TransactionStatuses, TransactionTypes } from '../../../../../../Transactions.js';

/** Shorthand for the accounts mapper. */
const MAP_ACCOUNTS = DISCOUNT_SCRAPE_CONFIG.accounts.mapper;

/** Shorthand for the transactions mapper. */
const MAP_TRANSACTIONS = DISCOUNT_SCRAPE_CONFIG.transactions.mapper;

/** Shorthand for the request builder. */
const BUILD_REQUEST = DISCOUNT_SCRAPE_CONFIG.transactions.buildRequest;

/** Minimal Discount transaction fixture. */
const DISCOUNT_TXN = {
  OperationNumber: 1001,
  OperationDate: '20260115',
  ValueDate: '20260201',
  OperationAmount: -250,
  OperationDescriptionToDisplay: 'Supermarket',
};

describe('DISCOUNT_SCRAPE_CONFIG', () => {
  describe('accounts.mapper', () => {
    it('extracts account IDs from UserAccountsData', () => {
      const raw = {
        UserAccountsData: {
          UserAccounts: [{ NewAccountInfo: { AccountID: '12345' } }],
        },
      };
      const result = MAP_ACCOUNTS(raw);
      expect(result).toHaveLength(1);
      expect(result[0].accountId).toBe('12345');
      expect(result[0].balance).toBe(0);
    });

    it('maps multiple accounts', () => {
      const raw = {
        UserAccountsData: {
          UserAccounts: [
            { NewAccountInfo: { AccountID: 'A1' } },
            { NewAccountInfo: { AccountID: 'A2' } },
          ],
        },
      };
      const result = MAP_ACCOUNTS(raw);
      expect(result).toHaveLength(2);
      expect(result[1].accountId).toBe('A2');
    });
  });

  describe('transactions.mapper', () => {
    it('returns empty when block is absent', () => {
      const raw = {};
      const result = MAP_TRANSACTIONS(raw);
      expect(result).toEqual([]);
    });

    it('handles null OperationEntry', () => {
      const raw = {
        CurrentAccountLastTransactions: {
          OperationEntry: null,
          CurrentAccountInfo: { AccountBalance: 500 },
          FutureTransactionsBlock: {
            FutureTransactionEntry: [DISCOUNT_TXN],
          },
        },
      };
      const result = MAP_TRANSACTIONS(raw);
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe(TransactionStatuses.Pending);
    });

    it('handles null FutureTransactionEntry', () => {
      const raw = {
        CurrentAccountLastTransactions: {
          OperationEntry: [DISCOUNT_TXN],
          CurrentAccountInfo: { AccountBalance: 500 },
          FutureTransactionsBlock: { FutureTransactionEntry: null },
        },
      };
      const result = MAP_TRANSACTIONS(raw);
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe(TransactionStatuses.Completed);
    });

    it('maps both completed and pending transactions', () => {
      const pendingTxn = { ...DISCOUNT_TXN, OperationNumber: 2002 };
      const raw = {
        CurrentAccountLastTransactions: {
          OperationEntry: [DISCOUNT_TXN],
          CurrentAccountInfo: { AccountBalance: 500 },
          FutureTransactionsBlock: {
            FutureTransactionEntry: [pendingTxn],
          },
        },
      };
      const result = MAP_TRANSACTIONS(raw);
      expect(result).toHaveLength(2);
      expect(result[0].status).toBe(TransactionStatuses.Completed);
      expect(result[1].status).toBe(TransactionStatuses.Pending);
    });

    it('maps transaction fields correctly', () => {
      const raw = {
        CurrentAccountLastTransactions: {
          OperationEntry: [DISCOUNT_TXN],
          CurrentAccountInfo: { AccountBalance: 500 },
          FutureTransactionsBlock: { FutureTransactionEntry: null },
        },
      };
      const result = MAP_TRANSACTIONS(raw);
      const txn = result[0];
      expect(txn.type).toBe(TransactionTypes.Normal);
      expect(txn.identifier).toBe(1001);
      expect(txn.originalAmount).toBe(-250);
      expect(txn.chargedAmount).toBe(-250);
      expect(txn.originalCurrency).toBe('ILS');
      expect(txn.description).toBe('Supermarket');
    });
  });

  describe('transactions.buildRequest', () => {
    it('constructs URL with account and date params', () => {
      const result = BUILD_REQUEST('12345', '20260101');
      expect(result.path).toContain('lastTransactions/12345/Date');
      expect(result.path).toContain('FromDate=20260101');
      expect(result.path).toContain('IsCategoryDescCode=True');
      expect(result.path).toContain('IsFutureTransactionFlag=True');
      expect(result.postData).toEqual({});
    });
  });

  describe('extraHeaders', () => {
    it('returns empty object', () => {
      const headers = DISCOUNT_SCRAPE_CONFIG.extraHeaders({} as never);
      expect(headers).toEqual({});
    });
  });

  describe('config shape', () => {
    it('uses GET method for accounts', () => {
      expect(DISCOUNT_SCRAPE_CONFIG.accounts.method).toBe('GET');
    });

    it('uses GET method for transactions', () => {
      expect(DISCOUNT_SCRAPE_CONFIG.transactions.method).toBe('GET');
    });

    it('has no pagination', () => {
      expect(DISCOUNT_SCRAPE_CONFIG.pagination.kind).toBe('none');
    });

    it('uses ILS as default currency', () => {
      expect(DISCOUNT_SCRAPE_CONFIG.defaultCurrency).toBe('ILS');
    });
  });
});
