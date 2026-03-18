/**
 * Edge-case branch tests for getMemo in MaxHelpers.ts.
 * Targets: no-receiver early return, receiver-only, receiver+comments,
 * receiver+fundsTransferComment.
 */
import { getMemo } from '../../Scrapers/Max/MaxHelpers.js';

describe('getMemo — all branches', () => {
  const cases = [
    ['returns empty when all fields empty (no receiver early return)', '', '', '', ''],
    ['returns comments when no receiver', 'some note', '', '', 'some note'],
    ['returns receiver alone when no comments', '', 'John', '', 'John'],
    ['returns comments + receiver when both present', 'Transfer', 'John', '', 'Transfer John'],
    [
      'appends fundsTransferComment when present',
      'Transfer',
      'John',
      'rent',
      'Transfer John: rent',
    ],
    ['returns receiver: comment when no comments', '', 'John', 'rent', 'John: rent'],
  ] as const;

  it.each(cases)('%s', (...args: readonly [string, string, string, string, string]) => {
    const [, comments, receiver, comment, expected] = args;
    const result = getMemo({
      comments,
      fundsTransferReceiverOrTransfer: receiver,
      fundsTransferComment: comment,
    });
    expect(result).toBe(expected);
  });
});
