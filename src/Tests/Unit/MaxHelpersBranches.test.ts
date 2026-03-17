import { getMemo } from '../../Scrapers/Max/MaxHelpers.js';

describe('getMemo — branch coverage', () => {
  it('returns comments when no fundsTransferReceiverOrTransfer', () => {
    const result = getMemo({
      comments: 'Regular purchase',
      fundsTransferReceiverOrTransfer: '',
      fundsTransferComment: '',
    });
    expect(result).toBe('Regular purchase');
  });

  it('combines comments with receiver when both present', () => {
    const result = getMemo({
      comments: 'Transfer',
      fundsTransferReceiverOrTransfer: 'John',
      fundsTransferComment: '',
    });
    expect(result).toBe('Transfer John');
  });

  it('uses only receiver when no comments', () => {
    const result = getMemo({
      comments: '',
      fundsTransferReceiverOrTransfer: 'Alice',
      fundsTransferComment: '',
    });
    expect(result).toBe('Alice');
  });

  it('appends fundsTransferComment when present', () => {
    const result = getMemo({
      comments: 'Wire',
      fundsTransferReceiverOrTransfer: 'Bob',
      fundsTransferComment: 'Monthly rent',
    });
    expect(result).toBe('Wire Bob: Monthly rent');
  });

  it('combines receiver and comment without comments', () => {
    const result = getMemo({
      comments: '',
      fundsTransferReceiverOrTransfer: 'Carol',
      fundsTransferComment: 'Payment',
    });
    expect(result).toBe('Carol: Payment');
  });
});
