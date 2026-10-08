/**
 * Cross-bank DigitalV3 currency contract (issue #614).
 *
 * <p>Amex and Isracard DigitalV3 `GetTransactionsList` rows carry two
 * currency fields side by side: `originalCurrency` holds a numeric enum
 * (0=ILS, 19=USD, 100=EUR) and `originalCurrencyIso` holds the ISO-4217
 * code. The WK `currency` alias list is first-match-wins, so its order
 * alone decides what `ITransaction.originalCurrency` reports. This test
 * drives each bank's fixture through the production ApiDirect route
 * (`merge<Bank>Rows` → `autoMapTransaction`) and asserts ISO codes.
 *
 * <p>The defect escaped because the Phase G dedup fixtures are ILS-only
 * and no test asserted the mapped currency, so a numeric `"0"` passed
 * unnoticed for every row.
 *
 * <p>RED when:
 * <ul>
 *   <li>`originalCurrency` precedes `originalCurrencyIso` in the WK
 *       `currency` alias list (emits `"0"`, `"19"`, `"100"`), OR</li>
 *   <li>an alias reorder changes the precedence pinned below: other
 *       aliases keep their currency, `currency` still beats
 *       `originalCurrencyIso`, and a numeric-only row still reports
 *       its raw digits (enum translation is deferred, not done), OR</li>
 *   <li>a blank or whitespace-only alias value wins the match and masks
 *       the next usable alias (emits `"ILS"` or `"   "`).</li>
 * </ul>
 *
 * <p>GREEN once `originalCurrencyIso` precedes the numeric alias.
 */

import { jest } from '@jest/globals';

import { mergeAmexRows } from '../../../../Scrapers/Pipeline/Banks/Amex/scrape/AmexShapeExtract.js';
import { mergeIsracardRows } from '../../../../Scrapers/Pipeline/Banks/Isracard/scrape/IsracardShapeExtract.js';
import { autoMapTransaction } from '../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapeAutoMapper.js';
import { findCurrencyHit } from '../../../../Scrapers/Pipeline/Mediator/Scrape/TxnMapper/TxnCurrency.js';
import type { ITransaction } from '../../../../Transactions.js';
import {
  CURRENCY_BANKS,
  type CurrencyBank,
  type ICurrencyFixture,
  makeCurrencyFixture,
} from '../Strategy/Scrape/Fixtures/CrossBankCurrency/_makeCurrencyFixture.js';

/** The currency projection of a mapped transaction this suite asserts on. */
type CurrencyView = Pick<ITransaction, 'originalAmount' | 'originalCurrency' | 'chargedCurrency'>;

/** A bank shape's production row flattener. */
type MergeRows = (body: object) => readonly object[];

/** Production row flattener per DigitalV3 bank — one entry per bank. */
const MERGE_ROWS: Readonly<Record<CurrencyBank, MergeRows>> = {
  amex: mergeAmexRows,
  isracard: mergeIsracardRows,
};

/** Minimum a record needs to survive the mapper's date/amount gate. */
const BASE = { date: '2026-02-03', amount: -300, description: 'MERCHANT' };

/**
 * Map raw rows exactly as the ApiDirect scrape phase does (`mapTxns`).
 *
 * @param raws - Rows emitted by the bank shape's row flattener.
 * @returns Mapped transactions, with rejected rows dropped.
 */
function mapRows(raws: readonly object[]): readonly ITransaction[] {
  const widened = raws as unknown as readonly Record<string, unknown>[];
  const results = widened.map((raw): ITransaction | false => autoMapTransaction(raw, true));
  return results.filter((t): t is ITransaction => t !== false);
}

/**
 * Order currency views by amount, original currency, then charged
 * currency, so any two distinct views compare non-zero (a total order).
 *
 * @param a - Left view.
 * @param b - Right view.
 * @returns Negative, zero or positive, per `Array.prototype.sort`.
 */
function compareViews(a: CurrencyView, b: CurrencyView): number {
  const byAmount = a.originalAmount - b.originalAmount;
  if (byAmount !== 0) return byAmount;
  const byOriginal = a.originalCurrency.localeCompare(b.originalCurrency);
  if (byOriginal !== 0) return byOriginal;
  return (a.chargedCurrency ?? '').localeCompare(b.chargedCurrency ?? '');
}

/**
 * Return a sorted copy of the given currency views.
 *
 * @param views - Views in any order.
 * @returns A new array ordered by {@link compareViews}.
 */
function sortViews(views: readonly CurrencyView[]): CurrencyView[] {
  return [...views].sort(compareViews);
}

/**
 * Run one bank's fixture through its flattener and the auto-mapper.
 *
 * @param bank - DigitalV3 bank under test.
 * @param fixture - That bank's loaded foreign-currency fixture.
 * @returns The sorted currency view of every mapped transaction.
 */
function mapFixture(bank: CurrencyBank, fixture: ICurrencyFixture): CurrencyView[] {
  const raws = MERGE_ROWS[bank](fixture.capture.responseBody);
  const txns = mapRows(raws);
  const views = txns.map((txn): CurrencyView => ({
    originalAmount: txn.originalAmount,
    originalCurrency: txn.originalCurrency,
    chargedCurrency: txn.chargedCurrency,
  }));
  return sortViews(views);
}

/**
 * Map one synthetic record and assert it survived the mapper.
 *
 * @param extra - Currency keys under test, merged over {@link BASE}.
 * @returns The mapped transaction.
 */
function mapped(extra: Record<string, unknown>): ITransaction {
  const result = autoMapTransaction({ ...BASE, ...extra });
  if (result === false) throw new TypeError('record was rejected by the mapper');
  return result;
}

describe('CrossBankCurrency — DigitalV3 numeric enum vs ISO code (#614)', () => {
  it.each(CURRENCY_BANKS)('crossBank_%s_NumericCurrencyEnum_ShouldMapToIsoCodes', (bank): void => {
    const fixture = makeCurrencyFixture(bank);
    const actual = mapFixture(bank, fixture);
    const expected = sortViews(fixture.meta.expectedTxns);
    expect(actual).toHaveLength(fixture.meta.expectedRecords);
    expect(actual).toEqual(expected);
  });
});

describe('CrossBankCurrency — pinned alias precedence outside the ISO pair', () => {
  it.each([
    ['trnCurrencySymbol', { trnCurrencySymbol: 'USD' }, 'USD'],
    ['currency', { currency: 'EUR' }, 'EUR'],
    ['currencyCode', { currencyCode: 'GBP' }, 'GBP'],
    ['currencyBeforeIso', { currency: 'EUR', originalCurrencyIso: 'USD' }, 'EUR'],
    ['numericOnly', { originalCurrency: 999 }, '999'],
    ['numericZero', { originalCurrency: 0 }, '0'],
    ['stringZero', { originalCurrency: '0' }, '0'],
  ])('alias_%s_ShouldResolvePinnedCurrency', (_alias, extra, expected): void => {
    const txn = mapped(extra);
    expect(txn.originalCurrency).toBe(expected);
  });
});

describe('CrossBankCurrency — blank currency alias falls through (#614)', () => {
  it.each([
    ['emptyIso', { originalCurrencyIso: '', originalCurrency: 19 }, '19'],
    ['whitespaceIso', { originalCurrencyIso: '   ', originalCurrency: 100 }, '100'],
    ['blankIsoNumericZero', { originalCurrencyIso: '', originalCurrency: 0 }, '0'],
    ['blankCurrencyBeforeIso', { currency: '', originalCurrencyIso: 'EUR' }, 'EUR'],
    [
      'blankRootNestedIso',
      { originalCurrencyIso: ' ', details: { originalCurrencyIso: 'USD' } },
      'USD',
    ],
    [
      'blankRootIsoRootNumericBeatsNestedIso',
      { originalCurrencyIso: ' ', originalCurrency: 19, details: { originalCurrencyIso: 'USD' } },
      '19',
    ],
  ])('blank_%s_ShouldSkipToNextUsableAlias', (_case, extra, expected): void => {
    const txn = mapped(extra);
    expect(txn.originalCurrency).toBe(expected);
  });

  it('baseline_nullIso_ShouldFallThroughToNumericAlias', (): void => {
    const txn = mapped({ originalCurrencyIso: null, originalCurrency: 19 });
    expect(txn.originalCurrency).toBe('19');
  });

  it('allBlank_ShouldYieldNoCurrencyHit', (): void => {
    const hit = findCurrencyHit({ originalCurrencyIso: '', originalCurrency: '  ' });
    expect(hit).toBe(false);
  });

  it('rootHit_ShouldNotReadNestedRecords', (): void => {
    const readNested = jest.fn((): string => 'EUR');
    const details = Object.defineProperty({}, 'originalCurrencyIso', {
      enumerable: true,
      get: readNested,
    });
    const hit = findCurrencyHit({ originalCurrencyIso: 'USD', details });
    expect(hit).toBe('USD');
    expect(readNested).not.toHaveBeenCalled();
  });
});
