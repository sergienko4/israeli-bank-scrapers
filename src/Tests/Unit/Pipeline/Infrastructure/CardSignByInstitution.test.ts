/**
 * Charge sign: decided by the institution, not by a payload sniff.
 *
 * Card issuers report a charge as a positive number; banks report the same
 * movement as negative. The mapper used to infer which it was from the
 * presence of a `dealSumType` field, which only some issuers send — so every
 * other card issuer was treated as a bank and its charges came out positive,
 * recorded as money received rather than spent.
 *
 * The failure is invisible in a successful scrape: no row is dropped, no error
 * is raised, and every amount looks like a plausible number. Only the sign is
 * wrong. These tests pin it.
 */

import { autoMapTransaction } from '../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapeAutoMapper.js';
import type { ITransaction } from '../../../../Transactions.js';

/** A charge as a card issuer reports it: positive, meaning "you owe this". */
const CHARGE = { date: '2026-02-03', amount: 122.17, description: 'MERCHANT' };

/**
 * Map a record and assert it survived the mapper's date/amount gate.
 *
 * @param raw - Provider record under test.
 * @param isCardIssuer - What the shape declares about the institution.
 * @returns The mapped transaction.
 */
function mapped(raw: Record<string, unknown>, isCardIssuer?: boolean): ITransaction {
  const result = autoMapTransaction(raw, isCardIssuer);
  if (result === false) throw new TypeError('record was rejected by the mapper');
  return result;
}

describe('charge sign by declared institution', () => {
  it('flips a card issuer charge to negative when the institution says it is a card', () => {
    expect(mapped(CHARGE, true).chargedAmount).toBe(-122.17);
  });

  it('leaves a bank amount untouched when the institution says it is not a card', () => {
    expect(mapped(CHARGE, false).chargedAmount).toBe(122.17);
  });

  it('flips a card issuer that sends NO dealSumType — the regression itself', () => {
    // This is the whole bug. Before the declaration existed, this row mapped to
    // +122.17: a spend recorded as income, in a scrape that reported success.
    const withoutTheSniffField = { ...CHARGE };
    expect(withoutTheSniffField).not.toHaveProperty('dealSumType');
    expect(mapped(withoutTheSniffField, true).chargedAmount).toBe(-122.17);
  });

  it('still infers from the payload when the caller declares nothing', () => {
    // Backwards compatibility for callers that pass no declaration: the old
    // inference is preserved exactly, including its blind spot.
    expect(mapped({ ...CHARGE, dealSumType: '2' }).chargedAmount).toBe(-122.17);
    expect(mapped({ ...CHARGE }).chargedAmount).toBe(122.17);
  });

  it('lets an explicit declaration override the payload sniff in both directions', () => {
    // A bank that happens to carry a dealSumType-shaped field must not have its
    // amounts flipped just because the field is present.
    expect(mapped({ ...CHARGE, dealSumType: '2' }, false).chargedAmount).toBe(122.17);
    expect(mapped({ ...CHARGE }, true).chargedAmount).toBe(-122.17);
  });

  it('leaves a zero amount alone rather than producing negative zero', () => {
    const zeroCharge = mapped({ ...CHARGE, amount: 0 }, true);
    const isNegativeZero = Object.is(zeroCharge.chargedAmount, -0);
    expect(isNegativeZero).toBe(false);
  });

  it('turns a refund back into money returned, rather than another charge', () => {
    // This test previously asserted the opposite, and was wrong. An issuer
    // reports a refund as a negative number; forcing the sign with
    // `-Math.abs()` made it a charge, so a purchase and its refund both counted
    // as spend and the refunded money never came back.
    expect(mapped({ ...CHARGE, amount: -401.55 }, true).chargedAmount).toBe(401.55);
  });
});

/**
 * A VisaCal row at the shape the API actually sends: `trnAmt` is an UNSIGNED
 * magnitude and the minus lives on `amtBeforeConvAndIndex`. Shape taken from a
 * real capture whose credit rows carry `trnType: "זיכוי"`, `refundInd: true`
 * and `trnTypeCode: "6"`. Amounts here are representative, not real.
 */
const VISACAL_REFUND = {
  date: '2026-01-05',
  trnAmt: 250,
  amtBeforeConvAndIndex: -250,
  description: 'MERCHANT',
};

/**
 * An Isracard row at its real shape: every amount field is signed, and the
 * original-currency amount differs from the billed one on a foreign purchase.
 */
const ISRACARD_FX_REFUND = {
  date: '2026-02-11',
  ilsAmount: -96.4,
  originalAmount: -25,
  description: 'MERCHANT',
};

describe('charge sign when only one of the two amount fields is signed', () => {
  it('returns a VisaCal refund as money back, in BOTH amount fields', () => {
    // The gap this covers. VisaCal never signs `trnAmt` — it is a magnitude —
    // so inverting it alone booked the refund as a 250 expense, while
    // `originalAmount` came out +250. The row contradicted itself.
    const txn = mapped(VISACAL_REFUND, true);
    expect(txn.chargedAmount).toBe(250);
    expect(txn.originalAmount).toBe(250);
  });

  it('keeps a VisaCal charge negative — both fields positive means a charge', () => {
    // Regression guard. The rows this must not touch are the ordinary charges
    // that happen to carry a non-default `trnTypeCode`: in the real payload
    // `trnTypeCode: "9"` rows are charges with `refundInd: false`, NOT credits.
    const charge = {
      ...VISACAL_REFUND,
      trnAmt: 180.5,
      amtBeforeConvAndIndex: 180.5,
      trnTypeCode: '9',
    };
    const txn = mapped(charge, true);
    expect(txn.chargedAmount).toBe(-180.5);
    expect(txn.originalAmount).toBe(-180.5);
  });

  it('carries the sign across currencies on a foreign refund', () => {
    // Both fields are signed here and differ in magnitude and currency. They
    // agree in direction, so nothing is reconciled — the amounts only invert.
    const txn = mapped(ISRACARD_FX_REFUND, true);
    expect(txn.chargedAmount).toBe(96.4);
    expect(txn.originalAmount).toBe(25);
  });

  it('carries the sign across currencies on a foreign charge', () => {
    const txn = mapped({ ...ISRACARD_FX_REFUND, ilsAmount: 148.8, originalAmount: 40 }, true);
    expect(txn.chargedAmount).toBe(-148.8);
    expect(txn.originalAmount).toBe(-40);
  });

  it('reconciles a foreign refund whose billed amount is unsigned', () => {
    const txn = mapped({ ...VISACAL_REFUND, trnAmt: 100, amtBeforeConvAndIndex: -25 }, true);
    expect(txn.chargedAmount).toBe(100);
    expect(txn.originalAmount).toBe(25);
  });

  it('keeps both amounts on the same side when the record omits the original', () => {
    // The original amount falls back to the charged one. Seeding that fallback
    // from the already-inverted value left the two fields with opposite signs
    // on every card row that omits an original amount.
    const txn = mapped(CHARGE, true);
    expect(txn.chargedAmount).toBe(-122.17);
    expect(txn.originalAmount).toBe(-122.17);
  });

  it('leaves a bank record alone even when its two amounts disagree', () => {
    // Reconciliation is scoped to declared card issuers. Banks net debit and
    // credit into an already-signed amount and must not be second-guessed.
    const txn = mapped({ ...VISACAL_REFUND, trnAmt: 250, amtBeforeConvAndIndex: -250 }, false);
    expect(txn.chargedAmount).toBe(250);
    expect(txn.originalAmount).toBe(-250);
  });

  it('does not produce negative zero when reconciling a zero amount', () => {
    const txn = mapped({ ...VISACAL_REFUND, trnAmt: 0 }, true);
    const isNegativeZero = Object.is(txn.chargedAmount, -0);
    expect(isNegativeZero).toBe(false);
  });
});
