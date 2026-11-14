/**
 * Provider-annotation coverage, one row shape per institution.
 *
 * {@link "../../../../Scrapers/Pipeline/Mediator/Scrape/TxnMapper/RestoredFields.js"}
 * and the `memo`/`category`/`chargedCurrency` Well-Known groups are only
 * useful if the alias each institution actually sends is in the dictionary. A
 * unit test built from invented key names cannot show that: it passes just as
 * happily against a dictionary that covers no real bank.
 *
 * So the table below carries key names lifted verbatim from captured forensic
 * runs under `C:\tmp\runs\pipeline\<bank>\`, one entry per institution whose
 * capture carries the field, with the row count that backs it. Values are
 * synthetic; only the shape is real. A bank losing coverage — because an alias
 * was renamed, reordered behind a more general one, or dropped — fails here.
 *
 * Cross-bank by construction rather than one file per bank: the dictionary is
 * shared, so the interesting failure is "this alias stopped resolving", which
 * is the same assertion for every institution.
 */

import { autoMapTransaction } from '../../../../Scrapers/Pipeline/Mediator/Scrape/TxnMapper/TxnMapper.js';
import type { ITransaction } from '../../../../Transactions.js';

/** Minimum a record needs to survive the mapper's date/amount gate. */
const BASE = { date: '2026-02-03', amount: -300, description: 'MERCHANT' };

/** The annotation fields this suite asserts on. */
type Annotations = Pick<ITransaction, 'memo' | 'category' | 'chargedCurrency'>;

/** One institution's real row shape and the annotations it must yield. */
interface ICase {
  readonly bank: string;
  readonly row: Record<string, unknown>;
  readonly expected: Annotations;
}

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

/**
 * Reduce a mapped transaction to just the annotations under test.
 *
 * @param txn - Mapped transaction.
 * @returns Its memo, category and charged currency.
 */
function annotations(txn: ITransaction): Annotations {
  return { memo: txn.memo, category: txn.category, chargedCurrency: txn.chargedCurrency };
}

const CASES: readonly ICase[] = [
  {
    // 1305 rows; branchCodeDesc on 1233, debCrdCurrencySymbol on all 1305.
    // The memo arrives as a LIST here, not a string — 57 rows carry one.
    bank: 'visacal',
    row: {
      branchCodeDesc: 'SECTOR',
      debCrdCurrencySymbol: '₪',
      transTypeCommentDetails: ['COMMENT'],
    },
    expected: { memo: 'COMMENT', category: 'SECTOR', chargedCurrency: 'ILS' },
  },
  {
    // 284 rows; transactionDescription and billingAmountCurrencySymbol on all
    // of them, moreInfo non-blank on 73.
    bank: 'isracard',
    row: {
      moreInfo: 'NOTE',
      transactionDescription: 'SECTOR',
      billingAmountCurrencySymbol: '₪',
    },
    expected: { memo: 'NOTE', category: 'SECTOR', chargedCurrency: 'ILS' },
  },
  {
    // 285 rows, same payload family as Isracard — same aliases must serve both.
    bank: 'amex',
    row: {
      moreInfo: 'NOTE',
      transactionDescription: 'SECTOR',
      billingAmountCurrencySymbol: '₪',
    },
    expected: { memo: 'NOTE', category: 'SECTOR', chargedCurrency: 'ILS' },
  },
  {
    // 626 rows; OperationDescription2 on 598, CategoryDescription on 231. No
    // charged-currency field in this payload at all.
    bank: 'discount',
    row: { OperationDescription2: 'NOTE', CategoryDescription: 'SECTOR' },
    expected: { memo: 'NOTE', category: 'SECTOR', chargedCurrency: undefined },
  },
  {
    // 65 rows reached only after the stringified `jsonResp` envelope is
    // unwrapped; AdditionalData non-blank on 17. PascalCase keys, which is why
    // alias matching has to stay case-insensitive.
    bank: 'leumi',
    row: { AdditionalData: 'NOTE' },
    expected: { memo: 'NOTE', category: undefined, chargedCurrency: undefined },
  },
  {
    // The nested beneficiary block, which no alias can express — the four
    // parts are joined the way the per-institution scraper joins them.
    bank: 'hapoalim',
    row: {
      beneficiaryDetailsData: {
        partyHeadline: 'HEADLINE',
        partyName: 'NAME',
        messageHeadline: 'MSG',
        messageDetail: 'DETAIL',
      },
    },
    expected: {
      memo: 'HEADLINE NAME. MSG DETAIL.',
      category: undefined,
      chargedCurrency: undefined,
    },
  },
];

describe('provider-annotation coverage, per institution', () => {
  it.each(CASES)('$bank keeps the annotations its payload carries', ({ row, expected }) => {
    const txn = mapped(row);
    const actual = annotations(txn);
    expect(actual).toEqual(expected);
  });

  it('leaves all three absent on a row that carries none of them', () => {
    const bare = mapped({});
    const actual = annotations(bare);
    expect(actual).toEqual({ memo: undefined, category: undefined, chargedCurrency: undefined });
  });
});
