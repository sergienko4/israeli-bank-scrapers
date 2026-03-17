/**
 * Additional branch coverage tests for getMemo in MaxHelpers.ts.
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
});
