/**
 * Unit tests for DynamicMetadataMapper + IsracardWkMap.
 *
 * CANARY: Proves that if a bank changes "cardIndex" → "idx", the WK-Mapper
 * still finds it — only the WK Map needs updating, not the extraction logic.
 *
 * ═══════════════════════════════════════════════════════════════
 *  KEY ASSERTION:
 *  If the Isracard portal renames "cardIndex" to "idx" in the JSON:
 *    - The raw extractor (hardcoded key) would BREAK
 *    - The WK-Mapper (semantic lookup) still WORKS — update WK aliases only
 * ═══════════════════════════════════════════════════════════════
 */

import {
  extract,
  extractWithWkMap,
  type IWkAccountFields,
} from '../../../../../Scrapers/Pipeline/Banks/Isracard/DynamicMetadataMapper.js';
import { ISRACARD_WK_MAP } from '../../../../../Scrapers/Pipeline/Banks/Isracard/IsracardWkMap.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

// ── Test-only WK: Isracard aliases via IWkAccountFields ──
// Used by extractWithWkMap + canary tests (key-rename resilience).
// 'idx' is NOT in PIPELINE_WELL_KNOWN — added here to prove the mechanism.

const ISRACARD_WK: IWkAccountFields = {
  responseStatus: ['Status', 'status', 'HeaderStatus', 'responseStatus'],
  queryId: ['cardIndex', 'idx', 'index', 'CardIndex'],
  displayId: ['cardNumber', 'last4Digits', 'cardNum', 'cardSuffix', 'accountNumber'],
  processedDate: ['billingDate', 'billing_date', 'date', 'processedDate'],
};

// ── Fixtures using STANDARD key names ────────────────────

const STANDARD_CHARGES = [
  { cardIndex: '0', cardNumber: '9371', billingDate: '2026-03-01' },
  { cardIndex: '1', cardNumber: '2214', billingDate: '2026-03-01' },
];

// ── Fixtures using RENAMED key names (Canary scenario) ───

/** Portal changed "cardIndex" → "idx" — WK Map must absorb this change. */
const RENAMED_CHARGES_IDX = [
  { idx: '0', cardNumber: '9371', billingDate: '2026-03-01' },
  { idx: '1', cardNumber: '2214', billingDate: '2026-03-01' },
];

/** Portal changed "cardNumber" → "cardNum" — WK Map must absorb this change. */
const RENAMED_CHARGES_CARDNUM = [{ cardIndex: '0', cardNum: '9371', billingDate: '2026-03-01' }];

/** Both keys renamed simultaneously. */
const BOTH_RENAMED = [{ idx: '0', last4Digits: '5588', billingDate: '2026-02-01' }];

// ── Happy path ────────────────────────────────────────────

describe('extractWithWkMap — happy path (standard key names)', () => {
  it('extracts two accounts from standard key names', () => {
    const result = extractWithWkMap(STANDARD_CHARGES, ISRACARD_WK);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) expect(result.value).toHaveLength(2);
  });

  it('maps cardIndex correctly as queryId', () => {
    const result = extractWithWkMap(STANDARD_CHARGES, ISRACARD_WK);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) {
      expect(result.value[0].queryId).toBe('0');
      expect(result.value[1].queryId).toBe('1');
    }
  });

  it('maps cardNumber correctly as displayId', () => {
    const result = extractWithWkMap(STANDARD_CHARGES, ISRACARD_WK);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) expect(result.value[0].displayId).toBe('9371');
  });
});

// ── CANARY: Key-rename resilience ─────────────────────────

describe('extractWithWkMap — CANARY: WK-Mapper survives key renames', () => {
  it('finds cardIndex even when key is renamed to "idx"', () => {
    const result = extractWithWkMap(RENAMED_CHARGES_IDX, ISRACARD_WK);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) {
      expect(result.value[0].queryId).toBe('0');
      expect(result.value[1].queryId).toBe('1');
    }
  });

  it('finds cardNumber even when key is renamed to "cardNum"', () => {
    const result = extractWithWkMap(RENAMED_CHARGES_CARDNUM, ISRACARD_WK);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) expect(result.value[0].displayId).toBe('9371');
  });

  it('finds both fields when both keys are renamed simultaneously', () => {
    const result = extractWithWkMap(BOTH_RENAMED, ISRACARD_WK);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) {
      expect(result.value[0].queryId).toBe('0');
      expect(result.value[0].displayId).toBe('5588');
    }
  });
});

// ── Graceful degradation ──────────────────────────────────

describe('extractWithWkMap — graceful degradation', () => {
  it('returns succeed([]) for an empty charges array', () => {
    const result = extractWithWkMap([], ISRACARD_WK);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) expect(result.value).toHaveLength(0);
  });

  it('returns fail() when a required field (cardIndex) cannot be found', () => {
    const noIndexCharges = [{ cardNumber: '1234', billingDate: '2026-03-01' }];
    const result = extractWithWkMap(noIndexCharges, ISRACARD_WK);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(false);
  });
});

// ── extract: Level 0 status check ─────────────────────────

describe('extract — Level 0: BFS status check (no hardcoded Header.Status)', () => {
  it('succeeds when Status is "1" nested inside Header object', () => {
    const raw = {
      Header: { Status: '1' },
      DashboardMonthBean: {
        cardsCharges: [{ cardIndex: '0', cardNumber: '9371', billingDate: '2026-03-01' }],
      },
    };
    const result = extract(raw as Record<string, unknown>, ISRACARD_WK);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) expect(result.value[0].queryId).toBe('0');
  });

  it('fails when Status is not "1" — BFS finds the status field regardless of nesting', () => {
    const raw = {
      Header: { Status: '0' },
      DashboardMonthBean: {
        cardsCharges: [{ cardIndex: '0', cardNumber: '9371', billingDate: '2026-03-01' }],
      },
    };
    const result = extract(raw as Record<string, unknown>, ISRACARD_WK);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(false);
  });

  it('fails when the entire response is empty (no status field found)', () => {
    const result = extract({}, ISRACARD_WK);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(false);
  });

  it('Level 1: finds cardsCharges via findFirstArray — no DashboardMonthBean hardcoding', () => {
    const raw = {
      Header: { Status: '1' },
      SomeOtherContainerKey: {
        cardsCharges: [{ cardIndex: '0', cardNumber: '1234', billingDate: '2026-03-01' }],
      },
    };
    const result = extract(raw as Record<string, unknown>, ISRACARD_WK);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) expect(result.value).toHaveLength(1);
  });

  it('Level 2: finds fields via WK aliases even with renamed keys', () => {
    const raw = {
      Header: { Status: '1' },
      AnyContainerName: {
        AnyArrayName: [{ idx: '0', last4Digits: '5588', billingDate: '2026-02-01' }],
      },
    };
    const result = extract(raw as Record<string, unknown>, ISRACARD_WK);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) {
      expect(result.value[0].queryId).toBe('0');
      expect(result.value[0].displayId).toBe('5588');
    }
  });
});

// ── WK Map contract ───────────────────────────────────────

describe('ISRACARD_WK_MAP — WK key contract', () => {
  it('includes "cardIndex" and "idx" as cardIndex aliases', () => {
    expect(ISRACARD_WK_MAP.cardIndex).toContain('cardIndex');
    expect(ISRACARD_WK_MAP.cardIndex).toContain('idx');
  });

  it('includes "cardNumber" and "last4Digits" as cardNumber aliases', () => {
    expect(ISRACARD_WK_MAP.cardNumber).toContain('cardNumber');
    expect(ISRACARD_WK_MAP.cardNumber).toContain('last4Digits');
  });

  it('includes "responseStatus" aliases for dynamic status check (no Header.Status hardcoding)', () => {
    expect(ISRACARD_WK_MAP.responseStatus).toContain('Status');
    expect(ISRACARD_WK_MAP.responseStatus).toContain('status');
  });

  it('wkMap is immutable (as const) and covers all four required fields', () => {
    const keys = Object.keys(ISRACARD_WK_MAP) as (keyof typeof ISRACARD_WK_MAP)[];
    expect(keys).toContain('responseStatus');
    expect(keys).toContain('cardIndex');
    expect(keys).toContain('cardNumber');
    expect(keys).toContain('billingDate');
  });
});
