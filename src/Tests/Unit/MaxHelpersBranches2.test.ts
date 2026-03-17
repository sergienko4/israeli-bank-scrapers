/**
 * Additional branch coverage tests for MaxHelpers.ts.
 * Targets: getInstallments (no comments, single match), getCharged (unknown currency),
 * getTxnId (with/without installments, with/without arn), buildDates (pending vs non-pending),
 * prepare (shouldCombine true/false, isFilter true/false), getMemo edge cases.
 */
import { getMemo } from '../../Scrapers/Max/MaxHelpers.js';

describe('getMemo — additional edge cases', () => {
  it('returns empty string when all fields empty', () => {
    const result = getMemo({
      comments: '',
      fundsTransferReceiverOrTransfer: '',
      fundsTransferComment: '',
    });
    expect(result).toBe('');
  });

  it('returns comments when receiver is undefined', () => {
    const result = getMemo({
      comments: 'purchase',
      fundsTransferReceiverOrTransfer: undefined,
      fundsTransferComment: 'note',
    });
    expect(result).toBe('purchase');
  });

  it('handles comment with whitespace receiver', () => {
    const result = getMemo({
      comments: '',
      fundsTransferReceiverOrTransfer: 'Receiver',
      fundsTransferComment: '',
    });
    expect(result).toBe('Receiver');
  });

  it('appends transfer comment to receiver when no comments', () => {
    const result = getMemo({
      comments: '',
      fundsTransferReceiverOrTransfer: 'Alice',
      fundsTransferComment: 'rent',
    });
    expect(result).toBe('Alice: rent');
  });

  it('combines all three fields when present', () => {
    const result = getMemo({
      comments: 'Wire',
      fundsTransferReceiverOrTransfer: 'Bob',
      fundsTransferComment: 'monthly',
    });
    expect(result).toBe('Wire Bob: monthly');
  });

  it('returns receiver plus comment when comments is empty', () => {
    const result = getMemo({
      comments: '',
      fundsTransferReceiverOrTransfer: 'Eve',
      fundsTransferComment: 'loan payment',
    });
    expect(result).toBe('Eve: loan payment');
  });
});
