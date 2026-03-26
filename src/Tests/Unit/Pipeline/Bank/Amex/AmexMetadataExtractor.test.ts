/**
 * Unit tests for AmexMetadataExtractor — TDD first pass.
 *
 * ARCHITECTURAL CONTEXT:
 * The Amex/Isracard DashboardMonth API returns card accounts as:
 *   { DashboardMonthBean: { cardsCharges: [{ cardIndex, cardNumber, billingDate }] } }
 *
 * The extractor is a pure Data Mapper:
 *   Input:  Record<string, unknown>  (raw DashboardMonth API response)
 *   Output: Procedure<readonly IAmexCardAccount[]>
 *
 * Rule #11: Zero custom DOM selectors. This extractor operates on JSON, not HTML.
 * Rule #15: Returns Procedure<T> — never raw primitives.
 */

import { extractAmexAccounts } from '../../../../../Scrapers/Pipeline/Banks/Amex/AmexMetadataExtractor.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

// ── Test fixtures ─────────────────────────────────────────

/** A valid DashboardMonth response with 2 cards. */
const VALID_TWO_CARDS = {
  Header: { Status: '1' },
  DashboardMonthBean: {
    cardsCharges: [
      { cardIndex: '0', cardNumber: '1234', billingDate: '2026-03-01' },
      { cardIndex: '1', cardNumber: '5678', billingDate: '2026-03-01' },
    ],
  },
};

/** A valid DashboardMonth response with a single card. */
const VALID_ONE_CARD = {
  Header: { Status: '1' },
  DashboardMonthBean: {
    cardsCharges: [{ cardIndex: '0', cardNumber: '9999', billingDate: '2026-02-01' }],
  },
};

/** A response with Status = '1' but no cardsCharges array. */
const MISSING_CHARGES = {
  Header: { Status: '1' },
  DashboardMonthBean: {},
};

/** A response where the entire DashboardMonthBean is absent. */
const MISSING_BEAN = {
  Header: { Status: '1' },
};

/** A response where Status indicates an API error. */
const ERROR_STATUS = {
  Header: { Status: '0' },
  DashboardMonthBean: {
    cardsCharges: [{ cardIndex: '0', cardNumber: '1234', billingDate: '2026-03-01' }],
  },
};

/** A completely empty object — malformed or network error. */
const EMPTY_RESPONSE = {};

// ── Happy path ────────────────────────────────────────────

describe('extractAmexAccounts — happy path', () => {
  it('returns success with two accounts from a two-card response', () => {
    const result = extractAmexAccounts(VALID_TWO_CARDS as Record<string, unknown>);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) {
      expect(result.value).toHaveLength(2);
    }
  });

  it('maps cardIndex correctly as the internal query identifier', () => {
    const result = extractAmexAccounts(VALID_TWO_CARDS as Record<string, unknown>);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) {
      expect(result.value[0].queryId).toBe('0');
      expect(result.value[1].queryId).toBe('1');
    }
  });

  it('maps cardNumber correctly as the display identifier (last4)', () => {
    const result = extractAmexAccounts(VALID_TWO_CARDS as Record<string, unknown>);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) {
      expect(result.value[0].displayId).toBe('1234');
      expect(result.value[1].displayId).toBe('5678');
    }
  });

  it('maps billingDate correctly', () => {
    const result = extractAmexAccounts(VALID_TWO_CARDS as Record<string, unknown>);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) {
      expect(result.value[0].processedDate).toBe('2026-03-01');
    }
  });

  it('returns success with one account from a single-card response', () => {
    const result = extractAmexAccounts(VALID_ONE_CARD as Record<string, unknown>);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0].displayId).toBe('9999');
    }
  });
});

// ── Graceful degradation ──────────────────────────────────

describe('extractAmexAccounts — graceful degradation', () => {
  it('returns success with empty array when cardsCharges is missing', () => {
    const result = extractAmexAccounts(MISSING_CHARGES as Record<string, unknown>);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) {
      expect(result.value).toHaveLength(0);
    }
  });

  it('returns success with empty array when DashboardMonthBean is absent', () => {
    const result = extractAmexAccounts(MISSING_BEAN as Record<string, unknown>);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) {
      expect(result.value).toHaveLength(0);
    }
  });

  it('returns fail() when Header.Status is not "1"', () => {
    const result = extractAmexAccounts(ERROR_STATUS as Record<string, unknown>);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(false);
  });

  it('returns fail() when the response object is empty (network error)', () => {
    const result = extractAmexAccounts(EMPTY_RESPONSE);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(false);
  });
});

// ── Type contract ─────────────────────────────────────────

describe('extractAmexAccounts — IAmexCardAccount shape', () => {
  it('each account has exactly cardIndex, cardNumber, billingDate properties', () => {
    const result = extractAmexAccounts(VALID_ONE_CARD as Record<string, unknown>);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) {
      const account = result.value[0];
      expect(typeof account.queryId).toBe('string');
      expect(typeof account.displayId).toBe('string');
      expect(typeof account.processedDate).toBe('string');
    }
  });

  it('cardIndex is distinct per card (0-indexed, used to key CardsTransactionsListBean)', () => {
    // The CardsTransactionsListBean keys transactions as "card_0", "card_1", etc.
    // This test confirms cardIndex values remain strings "0", "1" — NOT integers.
    const result = extractAmexAccounts(VALID_TWO_CARDS as Record<string, unknown>);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) {
      const indices = result.value.map(a => a.queryId);
      expect(indices).toEqual(['0', '1']);
    }
  });
});
