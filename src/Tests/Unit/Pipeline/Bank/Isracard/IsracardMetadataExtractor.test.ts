/**
 * Unit tests for IsracardMetadataExtractor — TDD first pass.
 *
 * ARCHITECTURAL CONTEXT:
 * Isracard and Amex share the same DashboardMonth API format:
 *   { DashboardMonthBean: { cardsCharges: [{ cardIndex, cardNumber, billingDate }] } }
 * The extractor is a pure Data Mapper: zero DOM access, Procedure<T> returns.
 *
 * WELL-KNOWN MEDIATOR MAP (Isracard Israel):
 *   Field         | Hebrew visible text            | WK key
 *   ──────────────┼───────────────────────────────┼──────────────
 *   Israeli ID    | תעודת זהות / מספר זהות         | id
 *   Password      | סיסמה / קוד כניסה              | password
 *   Card 6 digits | 6 ספרות / ספרות הכרטיס         | card6Digits
 *
 * PII SHIELD:
 *   cardNumber ("1234") — 4 chars → length exception → visible (safe for debug)
 *   cardIndex  ("0")    — 1 char  → length exception → visible (just an index)
 *   Future isracardToken (long) → automatically masked via WL_SENSITIVE_KEYS
 *
 * Rule #11: Zero custom DOM selectors. JSON-only Data Mapper.
 * Rule #15: Returns Procedure<T>. The existing Procedure<T> IS the Result Pattern —
 *           creating IScraperResult<T> would be a competing duplicate.
 */

import { extractIsracardAccounts } from '../../../../../Scrapers/Pipeline/Banks/Isracard/IsracardMetadataExtractor.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

// ── Test fixtures (Isracard uses identical DashboardMonth format to Amex) ───

const VALID_TWO_CARDS = {
  Header: { Status: '1' },
  DashboardMonthBean: {
    cardsCharges: [
      { cardIndex: '0', cardNumber: '9371', billingDate: '2026-03-01' },
      { cardIndex: '1', cardNumber: '2214', billingDate: '2026-03-01' },
    ],
  },
};

const VALID_ONE_CARD = {
  Header: { Status: '1' },
  DashboardMonthBean: {
    cardsCharges: [{ cardIndex: '0', cardNumber: '5588', billingDate: '2026-02-01' }],
  },
};

const MISSING_CHARGES = { Header: { Status: '1' }, DashboardMonthBean: {} };

const MISSING_BEAN = { Header: { Status: '1' } };

const ERROR_STATUS = {
  Header: { Status: '2' },
  DashboardMonthBean: {
    cardsCharges: [{ cardIndex: '0', cardNumber: '9371', billingDate: '2026-03-01' }],
  },
};

const EMPTY_RESPONSE = {};

// ── Happy path ────────────────────────────────────────────

describe('extractIsracardAccounts — happy path', () => {
  it('returns success with two accounts from a two-card response', () => {
    const result = extractIsracardAccounts(VALID_TWO_CARDS as Record<string, unknown>);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) expect(result.value).toHaveLength(2);
  });

  it('maps cardIndex as the internal query identifier', () => {
    const result = extractIsracardAccounts(VALID_TWO_CARDS as Record<string, unknown>);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) {
      expect(result.value[0].queryId).toBe('0');
      expect(result.value[1].queryId).toBe('1');
    }
  });

  it('maps cardNumber as the display identifier (last4)', () => {
    const result = extractIsracardAccounts(VALID_TWO_CARDS as Record<string, unknown>);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) {
      expect(result.value[0].displayId).toBe('9371');
      expect(result.value[1].displayId).toBe('2214');
    }
  });

  it('maps billingDate correctly', () => {
    const result = extractIsracardAccounts(VALID_TWO_CARDS as Record<string, unknown>);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) expect(result.value[0].processedDate).toBe('2026-03-01');
  });

  it('returns success with one account from a single-card response', () => {
    const result = extractIsracardAccounts(VALID_ONE_CARD as Record<string, unknown>);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0].displayId).toBe('5588');
    }
  });
});

// ── Graceful degradation ──────────────────────────────────

describe('extractIsracardAccounts — graceful degradation', () => {
  it('returns succeed([]) when cardsCharges is missing', () => {
    const result = extractIsracardAccounts(MISSING_CHARGES as Record<string, unknown>);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) expect(result.value).toHaveLength(0);
  });

  it('returns succeed([]) when DashboardMonthBean is absent', () => {
    const result = extractIsracardAccounts(MISSING_BEAN as Record<string, unknown>);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) expect(result.value).toHaveLength(0);
  });

  it('returns fail() when Header.Status is not "1"', () => {
    const result = extractIsracardAccounts(ERROR_STATUS as Record<string, unknown>);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(false);
  });

  it('returns fail() when the response is empty (network/WAF error)', () => {
    const result = extractIsracardAccounts(EMPTY_RESPONSE);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(false);
  });
});

// ── Type contract ─────────────────────────────────────────

describe('extractIsracardAccounts — IIsracardCardAccount shape', () => {
  it('each account has exactly cardIndex, cardNumber, billingDate as strings', () => {
    const result = extractIsracardAccounts(VALID_ONE_CARD as Record<string, unknown>);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) {
      const account = result.value[0];
      expect(typeof account.queryId).toBe('string');
      expect(typeof account.displayId).toBe('string');
      expect(typeof account.processedDate).toBe('string');
    }
  });

  it('cardIndex values are string "0", "1" — NOT numeric — for CardsTransactionsListBean key', () => {
    const result = extractIsracardAccounts(VALID_TWO_CARDS as Record<string, unknown>);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) {
      const indices = result.value.map(a => a.queryId);
      expect(indices).toEqual(['0', '1']);
    }
  });

  it('displayId is ≤4 chars — PII shield length exception keeps it visible for debug', () => {
    const result = extractIsracardAccounts(VALID_TWO_CARDS as Record<string, unknown>);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) {
      for (const account of result.value) {
        expect(account.displayId.length).toBeLessThanOrEqual(4);
      }
    }
  });
});
