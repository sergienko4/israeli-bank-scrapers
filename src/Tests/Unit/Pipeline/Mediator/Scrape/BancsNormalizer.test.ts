/**
 * BaNCS (Yahav) normalizer — synthetic, PII-free tests.
 *
 * <p>Proves the shape-guarded normalizer that Yahav's transaction extractor
 * applies to TCS BaNCS `Payload.DataEntity[]` records:
 *   1. a single boundary row (no usable prior balance) signs via the
 *      `TxnType` fallback map (`OutPymntOrd` → debit → negative);
 *   2. a multi-row set (deliberately shuffled) signs via the
 *      running-balance delta — debits negative, credits positive —
 *      after chronological sort;
 *   3. `normalizeBancsRecords` is a provable no-op for a non-BaNCS
 *      record (returned by reference, no `bancs*` keys added).
 *
 * Every value is fabricated (`FAKE-*`) — no real account data appears.
 */

import normalizeBancsRecords from '../../../../../Scrapers/Pipeline/Mediator/Scrape/Bancs/BancsNormalizer.js';

/** Synthetic BaNCS record parameters (all values fabricated — zero PII). */
interface IBancsArgs {
  readonly id: string;
  readonly day: number;
  readonly magnitude: string;
  readonly runBal: string;
  readonly typeCode: string;
  readonly srcId?: string;
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
 * Build the `TxnRef` envelope carrying a per-row source-transaction id,
 * shaped as the live BaNCS capture emits it.
 * @param srcId - Synthetic source-transaction reference; empty when absent.
 * @returns Nested `TxnRef` object, or `{}` when no reference is given.
 */
function txnRefFor(srcId = ''): Record<string, unknown> {
  if (srcId === '') return {};
  return { TxnRef: { TrnRefSrcTrns: { TrnIdentLst: [{ Id: { Id: srcId } }] } } };
}

/**
 * Build one synthetic BaNCS `DataEntity[]` record.
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
    ...txnRefFor(args.srcId),
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
 * Find a normalized row's signed amount by its normalized identifier.
 * @param rows - Normalized BaNCS rows.
 * @param id - Identifier to locate.
 * @returns The signed amount, or NaN when not found.
 */
function amountById(rows: readonly Record<string, unknown>[], id: string): number {
  const hit = rows.find((row): boolean => row.bancsIdentifier === id);
  const amount = hit?.bancsAmount;
  return typeof amount === 'number' ? amount : Number.NaN;
}

describe('BaNCS normalizer — sign resolution', () => {
  it('single OutPymntOrd (boundary row) → negative amount', () => {
    const record = buildBancsRecord({
      id: 'FAKE-SINGLE',
      day: 10,
      magnitude: '150',
      runBal: '500',
      typeCode: 'OutPymntOrd',
    });
    const rows = normalizeBancsRecords([record]);
    expect(rows).toHaveLength(1);
    expect(rows[0].bancsAmount).toBe(-150);
    expect(rows[0].bancsIdentifier).toBe('FAKE-SINGLE');
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
    const rows = normalizeBancsRecords([rowB, rowA, rowC]);
    const amountA = amountById(rows, 'FAKE-A');
    const amountB = amountById(rows, 'FAKE-B');
    const amountC = amountById(rows, 'FAKE-C');
    expect(rows).toHaveLength(3);
    expect(amountA).toBe(-200);
    expect(amountB).toBe(200);
    expect(amountC).toBe(-300);
  });
});

describe('BaNCS normalizer — per-row identifier', () => {
  it('distinguishes two rows that share one batch TRANSACTIONID', () => {
    const feeA = buildBancsRecord({
      id: 'FAKE-BATCH-1',
      day: 5,
      magnitude: '2.8',
      runBal: '1000',
      typeCode: 'InvcApplication',
      srcId: 'FAKE-SRC-1',
    });
    const feeB = buildBancsRecord({
      id: 'FAKE-BATCH-1',
      day: 5,
      magnitude: '1.2',
      runBal: '998.8',
      typeCode: 'InvcApplication',
      srcId: 'FAKE-SRC-2',
    });
    const rows = normalizeBancsRecords([feeA, feeB]);
    const ids = rows.map((row): unknown => row.bancsIdentifier);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain('FAKE-SRC-1');
    expect(ids).toContain('FAKE-SRC-2');
  });
});

describe('BaNCS normalizer — default-deny for non-BaNCS records', () => {
  it('returns a non-BaNCS record by reference', () => {
    const plain = { movementId: 'x', movementAmount: 90, description: 'demo' };
    const out = normalizeBancsRecords([plain]);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(plain);
    expect('bancsAmount' in out[0]).toBe(false);
  });
});
