/**
 * Phase F — cross-bank per-txn identifier extraction factory test.
 *
 * <p>Every Israeli bank's transaction API emits a stable per-txn unique
 * identifier (`Asmachta`-style). `extractTransactions` must surface
 * that identifier as `ITransaction.identifier` regardless of which
 * field name the bank uses. This factory test runs the SAME
 * `extractTransactions` function against one representative txn row
 * per bank (shape derived from PII-safe captured response excerpts)
 * and asserts the identifier propagates through.
 *
 * <p>RED on the current tree when:
 * <ul>
 *   <li>`WK.identifier` doesn't list the bank-specific alias, OR</li>
 *   <li>`coerceIdentifier` returns `false` for string identifiers
 *       (today's behaviour — drops Isracard `confirmationNumber`,
 *       Max `uid`, Discount `Urn`, etc.).</li>
 * </ul>
 *
 * <p>GREEN once both fixes ship in the same commit (Phase F).
 */

import { extractTransactions } from '../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapeAutoMapper.js';

/** Captured-row shape we feed into the auto-mapper. */
interface IBankRowFixture {
  readonly bank: string;
  readonly identifierField: string;
  readonly identifierValue: string | number;
  readonly row: Record<string, unknown>;
}

/**
 * One PII-safe synthetic row per bank. The shape mirrors the bank's
 * real API response (date alias, amount alias, identifier alias)
 * captured during the 2026-05-13 real-suite run. Merchant names are
 * masked; identifier values are opaque banking IDs (no PII surface).
 */
const BANK_ROWS: readonly IBankRowFixture[] = [
  {
    bank: 'isracard',
    identifierField: 'seqVoucherNumber',
    identifierValue: '482574739',
    row: {
      purchaseDate: '05/12/2025',
      businessName: '<merchant:isracard-1>',
      originalAmount: 92,
      originalCurrency: 0,
      ilsAmount: 92,
      seqVoucherNumber: '482574739',
      voucherNumber: 1275,
    },
  },
  {
    bank: 'isracard-approved',
    identifierField: 'confirmationNumber',
    identifierValue: '252890416:42',
    row: {
      purchaseDate: '13/05/2026',
      businessName: '<merchant:isracard-approval>',
      originalAmount: 240,
      originalCurrency: 0,
      ilsBillingAmount: 240,
      confirmationNumber: '252890416:42',
      seqConfirmationNumber: '0015962528904',
    },
  },
  {
    bank: 'amex',
    identifierField: 'seqVoucherNumber',
    identifierValue: '283313781',
    row: {
      purchaseDate: '01/05/2026',
      businessName: '<merchant:amex-1>',
      originalAmount: 399.4,
      originalCurrency: 0,
      ilsAmount: 399.4,
      seqVoucherNumber: '283313781',
    },
  },
  {
    bank: 'max',
    identifierField: 'uid',
    identifierValue: '26050809581827413972659',
    row: {
      purchaseDate: '2026-05-08T00:00:00',
      paymentDate: '2026-06-02T00:00:00',
      merchantName: '<merchant:max-1>',
      originalAmount: 13.84,
      originalCurrency: 'ILS',
      actualPaymentAmount: 13.84,
      uid: '26050809581827413972659',
    },
  },
  {
    bank: 'visacal',
    identifierField: 'trnIntId',
    identifierValue: '29605912174',
    row: {
      trnPurchaseDate: '2025-10-30T20:16:00',
      merchantName: '<merchant:visacal-1>',
      trnAmt: 51,
      trnCurrencySymbol: '₪',
      trnIntId: '29605912174',
    },
  },
  {
    bank: 'beinleumi',
    identifierField: 'reference',
    identifierValue: 99380,
    row: {
      dateOfRegistration: '2026-05-10T00:00:00',
      description: '<merchant:beinleumi-1>',
      creditAmount: 0,
      debitAmount: 15000,
      reference: 99380,
    },
  },
  {
    bank: 'hapoalim',
    identifierField: 'referenceNumber',
    identifierValue: 99031330,
    row: {
      eventDate: 20260414,
      activityDescription: '<merchant:hapoalim-1>',
      eventAmount: 150,
      referenceNumber: 99031330,
      valueDate: 20260414,
    },
  },
  {
    // Discount's response carries `OperationNumber` (numeric, already in the
    // pre-Phase-F alias list) AND `Urn` (long-form string ID). The alias-order
    // resolver picks `OperationNumber` when both are present — that path was
    // already working pre-Phase F. This fixture drops `OperationNumber` so the
    // test exercises the NEW `Urn` alias path that Phase F adds for banks /
    // captures where `OperationNumber` is absent.
    bank: 'discount',
    identifierField: 'Urn',
    identifierValue: '20260510205818648884PMS0P110',
    row: {
      OperationDate: '20260510',
      ValueDate: '20260510',
      OperationDescription: '<merchant:discount-1>',
      OperationDescriptionToDisplay: '<merchant:discount-1>',
      OperationAmount: 5000,
      Urn: '20260510205818648884PMS0P110',
    },
  },
];

/**
 * Wrap a single row in a 1-element array under a generic key so
 * `huntTransactions` BFS picks it up as a txn array.
 *
 * @param row - Single txn-shape record.
 * @returns Body shape `huntTransactions` accepts.
 */
function wrapAsResponseBody(row: Record<string, unknown>): Record<string, unknown> {
  return { txns: [row] };
}

const BANK_ROW_FIXTURES = BANK_ROWS.map((f): readonly [IBankRowFixture] => [f]);

describe('CrossBank — extractTransactions surfaces the bank-specific per-txn identifier', () => {
  it.each(BANK_ROW_FIXTURES)(
    'extractTransactions_$bank_$identifierField_ShouldPopulateIdentifier',
    fixture => {
      const body = wrapAsResponseBody(fixture.row);

      const txns = extractTransactions(body);

      expect(txns).toHaveLength(1);
      const [emitted] = txns;
      expect(emitted.identifier).toBeDefined();
      expect(emitted.identifier).toBe(fixture.identifierValue);
    },
  );
});
