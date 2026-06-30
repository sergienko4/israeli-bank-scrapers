/**
 * Unit tests for MirrorDetection — fingerprint-based duplicate account detection.
 */

import { detectMirroredAccounts } from '../../../../Scrapers/Pipeline/Mediator/Scrape/MirrorDetection.js';

/** Minimal txn shape matching ITxnFingerFields. */
interface IFingerTxn {
  readonly date: string;
  readonly chargedAmount?: number;
  readonly originalAmount?: number;
  readonly description?: string;
}

/** Minimal account shape. */
interface IFingerAccount {
  readonly accountNumber: string;
  readonly txns: readonly IFingerTxn[];
}

describe('detectMirroredAccounts', () => {
  it('returns single-account when fewer than 2 accounts', () => {
    const accounts: IFingerAccount[] = [{ accountNumber: 'A1', txns: [] }];
    const result = detectMirroredAccounts(accounts);
    expect(result.isMirrored).toBe(false);
    expect(result.message).toBe('single-account');
  });

  it('returns single-account for empty list', () => {
    const result = detectMirroredAccounts([]);
    expect(result.isMirrored).toBe(false);
    expect(result.message).toBe('single-account');
  });

  it('returns all-unique when fingerprints differ', () => {
    const accounts: IFingerAccount[] = [
      {
        accountNumber: 'A1',
        txns: [{ date: '2026-01-01', chargedAmount: -100, description: 'Coffee' }],
      },
      {
        accountNumber: 'A2',
        txns: [{ date: '2026-01-02', chargedAmount: -200, description: 'Lunch' }],
      },
    ];
    const result = detectMirroredAccounts(accounts);
    expect(result.isMirrored).toBe(false);
    expect(result.message).toBe('all-unique');
  });

  it('detects mirrored accounts when two share identical txn fingerprint', () => {
    const sameTxns: IFingerTxn[] = [
      { date: '2026-01-01', chargedAmount: -100, description: 'Coffee' },
      { date: '2026-01-02', chargedAmount: -50, description: 'Lunch' },
    ];
    const accounts: IFingerAccount[] = [
      { accountNumber: 'A1', txns: sameTxns },
      { accountNumber: 'A2', txns: sameTxns },
    ];
    const result = detectMirroredAccounts(accounts);
    expect(result.isMirrored).toBe(true);
    expect(result.message).toContain('MIRROR_SUSPECT');
  });

  it('treats order-different txn arrays as identical fingerprints', () => {
    const txns1: IFingerTxn[] = [
      { date: '2026-01-01', chargedAmount: -100, description: 'A' },
      { date: '2026-01-02', chargedAmount: -200, description: 'B' },
    ];
    const txns2: IFingerTxn[] = [...txns1].reverse();
    const accounts: IFingerAccount[] = [
      { accountNumber: 'A1', txns: txns1 },
      { accountNumber: 'A2', txns: txns2 },
    ];
    const result = detectMirroredAccounts(accounts);
    expect(result.isMirrored).toBe(true);
  });

  it('falls back to originalAmount when chargedAmount missing', () => {
    const txns: IFingerTxn[] = [{ date: '2026-01-01', originalAmount: -77, description: 'X' }];
    const accounts: IFingerAccount[] = [
      { accountNumber: 'A1', txns },
      { accountNumber: 'A2', txns },
    ];
    const result = detectMirroredAccounts(accounts);
    expect(result.isMirrored).toBe(true);
  });

  it('uses 0 when both amount fields absent', () => {
    const txns: IFingerTxn[] = [{ date: '2026-01-01', description: 'X' }];
    const accounts: IFingerAccount[] = [
      { accountNumber: 'A1', txns },
      { accountNumber: 'A2', txns },
    ];
    const result = detectMirroredAccounts(accounts);
    expect(result.isMirrored).toBe(true);
  });

  it('canonicalizeTxn: missing description → empty fallback (L53:1:1)', () => {
    // Test with txn lacking description — triggers `txn.description ?? ''` right side.
    const txns: IFingerTxn[] = [
      { date: '2026-01-01', originalAmount: 10 }, // no description
    ];
    const accounts: IFingerAccount[] = [
      { accountNumber: 'A1', txns },
      { accountNumber: 'A2', txns },
    ];
    const result = detectMirroredAccounts(accounts);
    expect(result.isMirrored).toBe(true);
  });

  // ── Empty-fingerprint exclusion (Phase 7f follow-up live-E2E finding) ──

  it('reports all-unique when every account is empty (no fingerprints to compare)', () => {
    // Three dormant cards — all produce the empty fingerprint. Without
    // the empty-skip rule the detector flagged MIRROR_SUSPECT (false
    // positive observed live on Amex/Isracard inactive cards).
    const accounts: IFingerAccount[] = [
      { accountNumber: 'A1', txns: [] },
      { accountNumber: 'A2', txns: [] },
      { accountNumber: 'A3', txns: [] },
    ];
    const result = detectMirroredAccounts(accounts);
    expect(result.isMirrored).toBe(false);
    expect(result.message).toBe('all-unique');
  });

  it('reports all-unique when only one non-empty account survives the empty filter', () => {
    // Two empty cards plus one with real data. After filtering empties
    // the survivor count is 1 — no pair to compare → all-unique.
    const accounts: IFingerAccount[] = [
      { accountNumber: 'A1', txns: [] },
      { accountNumber: 'A2', txns: [] },
      {
        accountNumber: 'A3',
        txns: [{ date: '2026-01-01', chargedAmount: -100, description: 'Coffee' }],
      },
    ];
    const result = detectMirroredAccounts(accounts);
    expect(result.isMirrored).toBe(false);
    expect(result.message).toBe('all-unique');
  });

  it('still flags real mirroring even when empty cards are mixed in', () => {
    // Two non-empty cards with identical txns + one empty. The empty
    // is filtered out; the two real cards still collide → MIRROR_SUSPECT.
    const sameTxns: IFingerTxn[] = [
      { date: '2026-02-15', chargedAmount: -42, description: 'Bookstore' },
    ];
    const accounts: IFingerAccount[] = [
      { accountNumber: 'A1', txns: sameTxns },
      { accountNumber: 'A2', txns: sameTxns },
      { accountNumber: 'A3', txns: [] },
    ];
    const result = detectMirroredAccounts(accounts);
    expect(result.isMirrored).toBe(true);
    expect(result.message).toContain('MIRROR_SUSPECT');
  });

  it('reproduces the live Amex/Isracard 3-of-8 false positive and now passes', () => {
    // Live audit shape from 2026-05-08 run: 5 active cards (one with
    // 0 active txns this window) + 3 fully empty cards → previously
    // reported `MIRROR_SUSPECT: 3 of 8`. Under the new rule the empties
    // drop out and the 5 active fingerprints stay unique.
    const dates: readonly string[] = [
      '2026-04-01',
      '2026-04-05',
      '2026-04-12',
      '2026-04-18',
      '2026-04-25',
    ];
    /**
     * Construct a non-empty card whose txn count + descriptions vary so
     * each card's fingerprint is unique.
     * @param cardId - Card identifier.
     * @param count - Number of FAKE txns to attach.
     * @returns Mirror-detection account row.
     */
    const makeCard = (cardId: string, count: number): IFingerAccount => ({
      accountNumber: cardId,
      txns: dates.slice(0, count).map((d, i): IFingerTxn => ({
        date: d,
        chargedAmount: -((i + 1) * 11) - (cardId.codePointAt(0) ?? 0),
        description: `${cardId}-FAKE-${String(i)}`,
      })),
    });
    const accounts: IFingerAccount[] = [
      makeCard('CARD-A', 22),
      makeCard('CARD-B', 23),
      makeCard('CARD-C', 25),
      makeCard('CARD-D', 6),
      makeCard('CARD-E', 0),
      { accountNumber: 'CARD-F', txns: [] },
      { accountNumber: 'CARD-G', txns: [] },
      { accountNumber: 'CARD-H', txns: [] },
    ];
    const result = detectMirroredAccounts(accounts);
    expect(result.isMirrored).toBe(false);
    expect(result.message).toBe('all-unique');
  });
});
