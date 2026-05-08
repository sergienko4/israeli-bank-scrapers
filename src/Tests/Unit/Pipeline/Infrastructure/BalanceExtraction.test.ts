import { resolveRecordBalance } from '../../../../Scrapers/Pipeline/Strategy/Scrape/Account/BalanceExtractor.js';

describe('resolveRecordBalance — Phase 7f follow-up: alias-list contract', () => {
  it('extracts the supplied alias when it matches a top-level field', () => {
    const bal = resolveRecordBalance({ balance: 1234.56, other: 'x' }, ['balance']);
    expect(bal).toBe(1234.56);
  });

  it('extracts a different alias when supplied (currentBalance)', () => {
    const bal = resolveRecordBalance({ currentBalance: 789.1 }, ['currentBalance']);
    expect(bal).toBe(789.1);
  });

  it('extracts nextTotalDebit when supplied', () => {
    const bal = resolveRecordBalance({ nextTotalDebit: 2500 }, ['nextTotalDebit']);
    expect(bal).toBe(2500);
  });

  it('extracts currentDebit when supplied', () => {
    const bal = resolveRecordBalance({ currentDebit: 1800 }, ['currentDebit']);
    expect(bal).toBe(1800);
  });

  it('extracts totalDebit when supplied', () => {
    const bal = resolveRecordBalance({ totalDebit: 3200.75 }, ['totalDebit']);
    expect(bal).toBe(3200.75);
  });

  it('extracts balance nested inside cardsCharges[] when alias supplied', () => {
    const record = { cardsCharges: [{ currentDebit: 555, cardUniqueId: 'X' }] };
    const bal = resolveRecordBalance(record, ['currentDebit']);
    expect(bal).toBe(555);
  });

  it('extracts balance nested inside result.accounts[] when alias supplied', () => {
    const record = { result: { accounts: [{ balance: 99.99 }] } };
    const bal = resolveRecordBalance(record, ['balance']);
    expect(bal).toBe(99.99);
  });

  it('returns false when alias is supplied but no matching field exists', () => {
    const record = { description: 'no balance here', txns: [] };
    const bal = resolveRecordBalance(record, ['balance']);
    expect(bal).toBe(false);
  });

  it('returns false for null / undefined input regardless of alias', () => {
    const resultNull = resolveRecordBalance(null, ['balance']);
    const resultUndef = resolveRecordBalance(undefined, ['balance']);
    expect(resultNull).toBe(false);
    expect(resultUndef).toBe(false);
  });

  it('returns false when alias list is empty (Phase 7f follow-up contract)', () => {
    const bal = resolveRecordBalance({ balance: 100 }, []);
    expect(bal).toBe(false);
  });

  it('returns false when supplied alias does not match the record field name', () => {
    const bal = resolveRecordBalance({ totalDebit: 200 }, ['balance']);
    expect(bal).toBe(false);
  });
});
