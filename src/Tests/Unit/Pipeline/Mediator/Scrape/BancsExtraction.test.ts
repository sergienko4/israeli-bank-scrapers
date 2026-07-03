/**
 * BaNCS (Yahav) transaction extraction — synthetic, PII-free tests.
 *
 * <p>Proves the shape-guarded BaNCS normalizer that teaches the shared
 * generic engine to read TCS BaNCS `Payload.DataEntity[]` records:
 *   1. a single boundary row (no usable prior balance) signs via the
 *      `TxnType` fallback map (`OutPymntOrd` → debit → negative);
 *   2. a multi-row set (deliberately shuffled) signs via the
 *      running-balance delta — debits negative, credits positive —
 *      after chronological sort;
 *   3. `normalizeBancsRecords` is a provable no-op for a non-BaNCS
 *      record (returned by reference, no `bancs*` keys added);
 *   4. end-to-end, a non-BaNCS `movements` bank is unaffected by the
 *      normalizer wired into `extractTransactions`.
 *
 * Every value is fabricated (`FAKE-*`) — no real account data appears.
 */

import normalizeBancsRecords from '../../../../../Scrapers/Pipeline/Mediator/Scrape/Bancs/BancsNormalizer.js';
import { extractTransactions } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapeAutoMapper.js';
import type { ITransaction } from '../../../../../Transactions.js';

/** Synthetic BaNCS record parameters (all values fabricated — zero PII). */
interface IBancsArgs {
  readonly id: string;
  readonly day: number;
  readonly magnitude: string;
  readonly runBal: string;
  readonly typeCode: string;
}

/**
 * Build a BaNCS `{Day,Month,Year}` calendar-date object (Jan 2026).
 * @param day - Day of month.
 * @returns Numeric calendar-date object (Month is 1-based, as BaNCS emits).
 */
function calDate(day: number): Record<string, number> {
  return { Day: day, Month: 1, Year: 2026 };
}

/**
 * Build one synthetic BaNCS `DataEntity[]` record. Includes top-level
 * `Memo` + `TxnId` so the content-based hunt walker discovers the array.
 * @param args - Synthetic record parameters.
 * @returns A raw BaNCS transaction record.
 */
function buildBancsRecord(args: IBancsArgs): Record<string, unknown> {
  const date = calDate(args.day);
  const amount = { Amt: { Value: args.magnitude }, CurrCode: { CDE: 'ILS', SYM: '₪' } };
  const type = {
    Desc: args.typeCode,
    OthrSubTyp: args.typeCode,
    TypVal: { CDE: 'PAYMENT', DSC: 'Payment' },
  };
  const runningBal = [{ CurrAmt: { Amt: { Value: args.runBal } }, BalType: { CDE: 'CURRENT' } }];
  const txnId = { TxnIds: { TRANSACTIONID: args.id } };
  return {
    OrigDt: date,
    PostedDt: date,
    TotalCurAmt: amount,
    TxnType: type,
    StmtRunningBal: runningBal,
    TxnId: txnId,
    Memo: `FAKE MEMO ${args.id}`,
  };
}

/**
 * Wrap synthetic records in the BaNCS `Payload.DataEntity` envelope.
 * @param records - Synthetic BaNCS records.
 * @returns MessageEnvelope-shaped body the hunt walker understands.
 */
function bancsEnvelope(records: readonly Record<string, unknown>[]): Record<string, unknown> {
  return { Payload: { DataEntity: records } };
}

/**
 * Find a mapped transaction's charged amount by identifier.
 * @param txns - Mapped transactions.
 * @param id - Identifier to locate.
 * @returns The charged amount, or NaN when not found.
 */
function amountById(txns: readonly ITransaction[], id: string): number {
  const hit = txns.find((t): boolean => t.identifier === id);
  return hit === undefined ? Number.NaN : hit.chargedAmount;
}

/**
 * Build a `StmtRunningBal` list carrying one CURRENT balance value.
 * @param value - Running-balance magnitude (string, as BaNCS emits).
 * @returns Single-element running-balance list.
 */
function runningBal(value: string): readonly Record<string, unknown>[] {
  return [{ CurrAmt: { Amt: { Value: value } }, BalType: { CDE: 'CURRENT' } }];
}

describe('BaNCS extraction — sign resolution', () => {
  it('single OutPymntOrd (boundary row) → negative charged amount', () => {
    const record = buildBancsRecord({
      id: 'FAKE-SINGLE',
      day: 10,
      magnitude: '150',
      runBal: '500',
      typeCode: 'OutPymntOrd',
    });
    const env = bancsEnvelope([record]);
    const txns = extractTransactions(env);
    expect(txns.length).toBe(1);
    expect(txns[0].chargedAmount).toBe(-150);
    expect(txns[0].identifier).toBe('FAKE-SINGLE');
  });

  it('three rows incl. a credit → running-balance delta assigns signs', () => {
    const rowA = buildBancsRecord({
      id: 'FAKE-A',
      day: 10,
      magnitude: '200',
      runBal: '1000',
      typeCode: 'OutPymntOrd',
    });
    const rowB = buildBancsRecord({
      id: 'FAKE-B',
      day: 11,
      magnitude: '200',
      runBal: '1200',
      typeCode: 'InDeposit',
    });
    const rowC = buildBancsRecord({
      id: 'FAKE-C',
      day: 12,
      magnitude: '300',
      runBal: '900',
      typeCode: 'OutPymntOrd',
    });
    const env = bancsEnvelope([rowB, rowA, rowC]);
    const txns = extractTransactions(env);
    expect(txns.length).toBe(3);
    const amtA = amountById(txns, 'FAKE-A');
    const amtB = amountById(txns, 'FAKE-B');
    const amtC = amountById(txns, 'FAKE-C');
    expect(amtA).toBe(-200);
    expect(amtB).toBe(200);
    expect(amtC).toBe(-300);
  });
});

describe('BaNCS extraction — default-deny for non-BaNCS records', () => {
  it('normalizeBancsRecords returns a non-BaNCS record by reference', () => {
    const plain = { movementId: 'x', movementAmount: 90, description: 'demo' };
    const out = normalizeBancsRecords([plain]);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(plain);
    expect('bancsAmount' in out[0]).toBe(false);
  });

  it('extractTransactions leaves a non-BaNCS movements bank unaffected', () => {
    const movement = {
      movementId: 'm-1',
      movementTimestamp: '2026-01-15T10:00:00',
      movementAmount: 90,
      movementCurrency: 'ILS',
      description: 'demo',
    };
    const env = { movements: [movement] };
    const txns = extractTransactions(env);
    expect(txns.length).toBe(1);
    expect(txns[0].chargedAmount).toBe(90);
  });
});

describe('BaNCS extraction — boundary + fallback branches', () => {
  it('unknown type + no balance → default debit and fills currency/date fallbacks', () => {
    const minimal = {
      OrigDt: { Day: 5, Month: 3, Year: 2026 },
      TotalCurAmt: { Amt: { Value: '75' } },
      TxnType: { OthrSubTyp: 'MysteryType' },
    };
    const out = normalizeBancsRecords([minimal]);
    const row = out[0];
    expect(row.bancsAmount).toBe(-75);
    expect(row.bancsCurrency).toBe('ILS');
    expect(row.bancsProcessedDate).toBe('2026-03-05');
    expect(row.bancsDescription).toBe('');
  });

  it('type/delta disagreement trusts the running-balance delta (credit)', () => {
    const older = {
      OrigDt: { Day: 1, Month: 1, Year: 2026 },
      TotalCurAmt: { Amt: { Value: '100' } },
      TxnType: { OthrSubTyp: 'OutPymntOrd' },
      StmtRunningBal: runningBal('1000'),
    };
    const newer = {
      OrigDt: { Day: 2, Month: 1, Year: 2026 },
      TotalCurAmt: { Amt: { Value: '200' } },
      TxnType: { OthrSubTyp: 'OutPymntOrd' },
      StmtRunningBal: runningBal('1200'),
    };
    const out = normalizeBancsRecords([older, newer]);
    expect(out[0].bancsAmount).toBe(-100);
    expect(out[1].bancsAmount).toBe(200);
  });

  it('non-numeric running balance falls back to the type-code direction', () => {
    const first = {
      OrigDt: { Day: 1, Month: 1, Year: 2026 },
      TotalCurAmt: { Amt: { Value: '100' } },
      TxnType: { OthrSubTyp: 'OutPymntOrd' },
      StmtRunningBal: runningBal('1000'),
    };
    const second = {
      OrigDt: { Day: 2, Month: 1, Year: 2026 },
      TotalCurAmt: { Amt: { Value: '200' } },
      TxnType: { OthrSubTyp: 'OutPymntOrd' },
      StmtRunningBal: runningBal('not-a-number'),
    };
    const out = normalizeBancsRecords([first, second]);
    expect(out[0].bancsAmount).toBe(-100);
    expect(out[1].bancsAmount).toBe(-200);
  });
});
