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
});
