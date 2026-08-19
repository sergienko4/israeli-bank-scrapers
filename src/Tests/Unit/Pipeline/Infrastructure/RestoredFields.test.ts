/**
 * Provider fields the shared auto-mapper used to drop.
 *
 * Every institution routes through `autoMapTransaction`, which populates a
 * field only when the payload carries a key listed for it in the Well-Known
 * dictionary — so five optional `ITransaction` fields, which have no entry
 * there, were never populated even when the payload carried them. These tests
 * assert each one is recovered, and that the recovery is keyed narrowly enough
 * that it cannot fire on a payload that does not have the field.
 *
 * Payload field names only; no real provider values.
 */

import { autoMapTransaction } from '../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapeAutoMapper.js';
import type { ITransaction } from '../../../../Transactions.js';
import { TransactionStatuses, TransactionTypes } from '../../../../Transactions.js';

/** Minimum a record needs to survive the mapper's date/amount gate. */
const BASE = { date: '2026-02-03', amount: -300, description: 'MERCHANT' };

/**
 * Map a record and assert it survived the mapper's date/amount gate.
 *
 * @param extra - Payload keys under test, merged over {@link BASE}.
 * @returns The mapped transaction.
 */
function mapped(extra: Record<string, unknown>): ITransaction {
  const result = autoMapTransaction({ ...BASE, ...extra });
  if (result === false) throw new TypeError('record was rejected by the mapper');
  return result;
}

describe('restoreProviderFields', () => {
  it('recovers a flat memo', () => {
    expect(mapped({ moreInfo: 'NOTE TEXT' }).memo).toBe('NOTE TEXT');
  });

  it('does not set a memo from a blank note, and trims a padded one', () => {
    // Isracard and Amex send `moreInfo` as a run of spaces on rows that carry
    // no note — 100 of 173 and 99 of 172 rows in the captured runs — so an
    // exact `=== ''` emptiness test turns most rows into a whitespace memo.
    expect(mapped({ moreInfo: '   ' }).memo).toBeUndefined();
    expect(mapped({ moreInfo: '\t\n ' }).memo).toBeUndefined();
    expect(mapped({ moreInfo: '  NOTE TEXT ' }).memo).toBe('NOTE TEXT');
  });

  it('flattens a nested beneficiary block into a single-line memo', () => {
    const txn = mapped({
      beneficiaryDetailsData: {
        partyHeadline: 'HEADLINE',
        partyName: 'NAME',
        messageHeadline: 'MSG',
        messageDetail: 'DETAIL',
      },
    });
    expect(txn.memo).toBe('HEADLINE NAME. MSG DETAIL.');
  });

  it('recovers the issuer category hint', () => {
    expect(mapped({ branchCodeDesc: 'CATEGORY' }).category).toBe('CATEGORY');
  });

  it('recovers the charged currency', () => {
    expect(mapped({ debCrdCurrencySymbol: 'USD' }).chargedCurrency).toBe('USD');
  });

  it('normalises a charged-currency symbol to its ISO code', () => {
    // Every one of the 1305 captured CAL rows sends "₪" here, so a value that
    // skipped normalisation would leak the symbol on essentially every row
    // while the sibling `currency` field on the same row reads "ILS".
    const symbols = ['₪', 'שח', 'ש"ח', 'NIS'];
    const codes = symbols.map((debCrdCurrencySymbol): string | undefined => {
      return mapped({ debCrdCurrencySymbol }).chargedCurrency;
    });
    const allIls = symbols.map((): string => 'ILS');
    expect(codes).toEqual(allIls);
  });

  it('marks a provisional row pending rather than settled', () => {
    expect(mapped({ serialNumber: 0 }).status).toBe(TransactionStatuses.Pending);
    expect(mapped({ trnPurchaseDate: '2026-02-03' }).status).toBe(TransactionStatuses.Pending);
  });

  it('leaves a settled row completed', () => {
    expect(mapped({ trnPurchaseDate: '2026-02-03', debCrdDate: '2026-03-02' }).status).toBe(
      TransactionStatuses.Completed,
    );
  });

  it('recovers instalment ordinals from explicit numeric fields', () => {
    expect(mapped({ numOfPayments: 10, curPaymentNum: 3 }).installments).toEqual({
      number: 3,
      total: 10,
    });
  });

  it('treats a pending instalment row as payment 1', () => {
    expect(mapped({ numberOfPayments: 10 }).installments).toEqual({ number: 1, total: 10 });
  });

  it('recovers instalment ordinals from a keyworded note', () => {
    expect(mapped({ moreInfo: 'תשלום 3 מתוך 10' }).installments).toEqual({ number: 3, total: 10 });
  });

  it('does not read an unrelated two-number note as an instalment plan', () => {
    expect(mapped({ moreInfo: 'REF 12 34' }).installments).toBeUndefined();
  });

  // The next three assert the ordinal contract rather than a captured payload.
  // Across the 1305 rows that carry a payments total, none is fractional and
  // none places the payment past the end of the plan — so these guard against
  // publishing an `installments` object the interface cannot honestly carry,
  // the same defect class as an instalment type with no ordinals behind it.
  it('rejects a note placing the payment past the end of the plan', () => {
    expect(mapped({ moreInfo: 'תשלום 11 מתוך 10' }).installments).toBeUndefined();
  });

  it('rejects explicit ordinals placing the payment past the end of the plan', () => {
    expect(mapped({ numOfPayments: 10, curPaymentNum: 11 }).installments).toBeUndefined();
  });

  it('rejects a fractional plan length', () => {
    expect(mapped({ numOfPayments: 3.5, curPaymentNum: 1 }).installments).toBeUndefined();
  });

  it('maps the instalment transaction type', () => {
    expect(mapped({ numOfPayments: 10, curPaymentNum: 3 }).type).toBe(
      TransactionTypes.Installments,
    );
  });

  it('does not read a transaction-type code as an instalment plan', () => {
    // Regression guard for the CAL type-code rule this fix removes. Its codes
    // classify the KIND of charge, not the payment structure: in a 1305-row
    // capture, 6 is a refund (זיכוי) and 7 a cash withdrawal (משיכת מזומן).
    // Treating "not 5 and not 9" as a plan marker labelled all nine such rows
    // `Installments` while leaving `installments` absent — a transaction that
    // contradicts itself. Ordinals alone classify all 1305 rows correctly.
    const codes = ['5', '6', '7', '8', '9'];
    const types = codes.map((trnTypeCode): TransactionTypes => {
      return mapped({ trnTypeCode, debCrdDate: '2026-03-02' }).type;
    });
    const allNormal = codes.map((): TransactionTypes => TransactionTypes.Normal);
    expect(types).toEqual(allNormal);
  });

  it('still reports a genuine CAL plan, which carries its own ordinals', () => {
    // The one real plan in that capture is code 8, and it sends numOfPayments —
    // so the ordinals it already carries are what classify it.
    const txn = mapped({
      trnTypeCode: '8',
      debCrdDate: '2026-03-02',
      numOfPayments: 3,
      curPaymentNum: 2,
    });
    expect(txn.type).toBe(TransactionTypes.Installments);
    expect(txn.installments).toEqual({ number: 2, total: 3 });
  });

  it('never reports an instalment type without the ordinals to back it', () => {
    const codes = ['5', '6', '7', '8', '9'];
    const contradictions = codes.filter((trnTypeCode): boolean => {
      const txn = mapped({ trnTypeCode, debCrdDate: '2026-03-02' });
      return txn.type === TransactionTypes.Installments && txn.installments === undefined;
    });
    expect(contradictions).toEqual([]);
  });

  it('leaves every restored field absent when the payload has none of them', () => {
    const txn = mapped({});
    expect(txn.memo).toBeUndefined();
    expect(txn.category).toBeUndefined();
    expect(txn.installments).toBeUndefined();
    expect(txn.status).toBe(TransactionStatuses.Completed);
    expect(txn.type).toBe(TransactionTypes.Normal);
  });

  it('does not overwrite the description the mapper already resolved', () => {
    expect(mapped({ moreInfo: 'NOTE TEXT' }).description).toBe('MERCHANT');
  });
});
