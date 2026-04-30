import { resolveRecordBalance } from '../../../../Scrapers/Pipeline/Strategy/Scrape/Account/BalanceExtractor.js';

describe('resolveRecordBalance', () => {
  it('extracts "balance" top-level field', () => {
    const bal = resolveRecordBalance({ balance: 1234.56, other: 'x' });
    expect(bal).toBe(1234.56);
  });

  it('extracts "currentBalance" (generic credit card)', () => {
    const bal = resolveRecordBalance({ currentBalance: 789.1 });
    expect(bal).toBe(789.1);
  });

  it('extracts "nextTotalDebit" (Isracard/Amex billing cycle)', () => {
    const bal = resolveRecordBalance({ nextTotalDebit: 2500 });
    expect(bal).toBe(2500);
  });

  it('extracts "currentDebit" (MAX/Isracard next billing)', () => {
    const bal = resolveRecordBalance({ currentDebit: 1800 });
    expect(bal).toBe(1800);
  });

  it('extracts "totalDebit" (Amex/Isracard total)', () => {
    const bal = resolveRecordBalance({ totalDebit: 3200.75 });
    expect(bal).toBe(3200.75);
  });

  it('extracts balance nested inside cardsCharges[]', () => {
    const record = { cardsCharges: [{ currentDebit: 555, cardUniqueId: 'X' }] };
    const bal = resolveRecordBalance(record);
    expect(bal).toBe(555);
  });

  it('extracts balance nested inside result.accounts[]', () => {
    const record = { result: { accounts: [{ balance: 99.99 }] } };
    const bal = resolveRecordBalance(record);
    expect(bal).toBe(99.99);
  });

  it('returns false when no balance-like field exists', () => {
    const record = { description: 'no balance here', txns: [] };
    const bal = resolveRecordBalance(record);
    expect(bal).toBe(false);
  });

  it('returns false for null / undefined input', () => {
    const resultNull = resolveRecordBalance(null);
    const resultUndef = resolveRecordBalance(undefined);
    expect(resultNull).toBe(false);
    expect(resultUndef).toBe(false);
  });
});
