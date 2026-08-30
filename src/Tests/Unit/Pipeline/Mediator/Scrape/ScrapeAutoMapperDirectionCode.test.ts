/**
 * ScrapeAutoMapper — numeric direction-code sign convention (issue #532).
 *
 * <p>Some banks report the amount as an unsigned MAGNITUDE and encode the
 * direction in a numeric activity code rather than a debit/credit word.
 * Hapoalim is the reference case: `eventAmount` is always positive and
 * `eventActivityTypeCode` carries the direction — 1 for money in, 2 for money
 * out. The upstream per-bank scraper applies exactly that rule
 * (`const isOutbound = txn.eventActivityTypeCode === 2`), and the captures
 * committed to this repo agree with it: code 1 sits on a `+150` credit whose
 * `currentBalance` rose by that amount, code 2 on a management fee.
 *
 * <p>The word-based WK.direction reader only matches strings, so a numeric
 * code never reached it and every outbound row mapped POSITIVE.
 *
 * <p>Rows are taken from the committed PII-redacted Hapoalim capture so the
 * shape under test is the production one, and are mapped through
 * `autoMapTransaction` — the same entry point `ApiDirectScrapeActions.mapTxns`
 * calls per row. That capture holds no non-zero outbound row, so the outbound
 * cases mark that same real row with the bank's own outbound code rather than
 * inventing a record shape.
 *
 * <p>The code is deliberately AUTHORITATIVE: it is an explicit statement by the
 * bank, so it must survive a conflicting worded field and a card issuer's
 * inverted convention. It is also read on the record ROOT only and compared by
 * strict numeric equality, so a nested sub-record or a reformatted value cannot
 * silently flip a transaction's sign.
 */

import { autoMapTransaction } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/TxnMapper/TxnMapper.js';
import type { ITransaction } from '../../../../../Transactions.js';
import { makeBankFixture } from '../../Strategy/Scrape/Fixtures/CrossBankDedup/_makeBankFixture.js';

/** One raw API record. */
type Row = Record<string, unknown>;

/** Activity code Hapoalim puts on an outbound (money-out) movement. */
const OUTBOUND = 2;
/** Activity code Hapoalim puts on an inbound (money-in) movement. */
const INBOUND = 1;

/**
 * The real captured Hapoalim transaction row, as committed.
 * @returns A mutable clone of the fixture's first transaction.
 */
function realRow(): Row {
  const { capture } = makeBankFixture('hapoalim');
  const body = capture.responseBody as unknown as { readonly transactions: readonly Row[] };
  return { ...body.transactions[0] };
}

/**
 * The real row re-marked with a given direction code and amount.
 * @param code - Value to place on `eventActivityTypeCode`.
 * @param amount - Unsigned magnitude to place on `eventAmount`.
 * @returns The cloned row.
 */
function rowWith(code: unknown, amount: number): Row {
  return { ...realRow(), eventActivityTypeCode: code, eventAmount: amount };
}

/**
 * The real row with no direction code at all.
 * @param amount - Unsigned magnitude to place on `eventAmount`.
 * @returns The cloned row.
 */
function rowWithoutCode(amount: number): Row {
  const row: Row = { ...realRow(), eventAmount: amount };
  delete row.eventActivityTypeCode;
  return row;
}

/**
 * Map one raw row exactly as `mapTxns` does.
 * @param row - Raw record to map.
 * @param isCard - Whether the institution is a card issuer.
 * @returns The mapped transaction.
 */
function mapRow(row: Row, isCard?: boolean): ITransaction {
  const mapped = autoMapTransaction(row, isCard);
  expect(mapped).not.toBe(false);
  return mapped as ITransaction;
}

/**
 * Charged amount the mapper produces for one raw row.
 * @param row - Raw record to map.
 * @returns The mapped `chargedAmount`.
 */
function chargedOf(row: Row): number {
  const txn = mapRow(row);
  return txn.chargedAmount;
}

describe('ScrapeAutoMapper/NumericDirectionCode', () => {
  it('maps the real captured inbound row positive, unchanged', () => {
    const row = realRow();
    const txn = mapRow(row);
    expect(txn.chargedAmount).toBe(150);
  });

  it('maps an outbound code to a negative charged amount', () => {
    const row = rowWith(OUTBOUND, 150);
    const charged = chargedOf(row);
    expect(charged).toBe(-150);
  });

  it('maps an outbound code to a negative original amount', () => {
    const row = rowWith(OUTBOUND, 150);
    const txn = mapRow(row);
    expect(txn.originalAmount).toBe(-150);
  });

  it('leaves an inbound code positive', () => {
    const row = rowWith(INBOUND, 150);
    const charged = chargedOf(row);
    expect(charged).toBe(150);
  });

  it('leaves an unrelated activity code untouched', () => {
    const row = rowWith(7, 150);
    const charged = chargedOf(row);
    expect(charged).toBe(150);
  });

  it('leaves a non-numeric code untouched', () => {
    const row = rowWith('n/a', 150);
    const charged = chargedOf(row);
    expect(charged).toBe(150);
  });

  it('leaves a row without the code field untouched', () => {
    const row = rowWithoutCode(150);
    const charged = chargedOf(row);
    expect(charged).toBe(150);
  });

  it('ignores an outbound code nested in a sub-record', () => {
    const row = rowWithoutCode(150);
    row.beneficiaryDetailsData = { eventActivityTypeCode: OUTBOUND };
    const charged = chargedOf(row);
    expect(charged).toBe(150);
  });

  it.each(['2', ' 2 ', '02', '2e0', '0x2', '+2'])(
    'does not read the reformatted code %p as outbound',
    code => {
      const row = rowWith(code, 150);
      const charged = chargedOf(row);
      expect(charged).toBe(150);
    },
  );

  it('lets an inbound code override a conflicting worded debit', () => {
    const coded = rowWith(INBOUND, 150);
    const row = { ...coded, creditDebit: 'DEBIT' };
    const charged = chargedOf(row);
    expect(charged).toBe(150);
  });

  it('lets an outbound code override a conflicting worded credit', () => {
    const coded = rowWith(OUTBOUND, 150);
    const row = { ...coded, creditDebit: 'CREDIT' };
    const charged = chargedOf(row);
    expect(charged).toBe(-150);
  });

  it('lets an inbound code override a card issuer inversion', () => {
    const row = rowWith(INBOUND, 150);
    const txn = mapRow(row, true);
    expect(txn.chargedAmount).toBe(150);
  });

  it('never yields -0 for a zero-amount outbound row', () => {
    const row = rowWith(OUTBOUND, 0);
    const charged = chargedOf(row);
    const isNegativeZero = Object.is(charged, -0);
    expect(isNegativeZero).toBe(false);
    expect(charged).toBe(0);
  });

  it('never yields -0 for a zero-amount worded debit row', () => {
    const uncoded = rowWithoutCode(0);
    const row = { ...uncoded, creditDebit: 'DEBIT' };
    const charged = chargedOf(row);
    const isNegativeZero = Object.is(charged, -0);
    expect(isNegativeZero).toBe(false);
    expect(charged).toBe(0);
  });
});
