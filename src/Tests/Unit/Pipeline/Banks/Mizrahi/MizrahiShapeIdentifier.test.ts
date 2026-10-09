/**
 * Mizrahi transaction identifier — parity with the legacy scraper.
 *
 * <p>Consumers store the identifier the legacy scraper published, so the
 * hard model keeps it: `<reference>-<TransactionNumber>` when one reference
 * holds several movements, else the reference as a number. Rows go through
 * the real extractor and the shared auto-mapper, so the cases also pin the WK
 * alias precedence. Bodies are synthetic (fake values).
 */

import { MIZRAHI_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/Mizrahi/scrape/MizrahiShape.js';
import { txnsExtractPage } from '../../../../../Scrapers/Pipeline/Banks/Mizrahi/scrape/MizrahiShapeTxns.js';
import type { ApiRecord } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/AutoMapperFacade/AutoMapperTypes.js';
import { autoMapTransaction } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapeAutoMapper.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { ITransaction } from '../../../../../Transactions.js';

/** A synthetic movement row; the overrides set the identifier inputs. */
const BASE_ROW = {
  RecTypeSpecified: true,
  MC02PeulaTaaEZ: '2026-10-08T00:00:00',
  MC02SchumEZ: -12.5,
  MC02TnuaTeurEZ: 'fake movement',
} as const;

/**
 * Map rows the way the scrape does: extract the page, then auto-map.
 * @param overrides - Identifier fields of each row.
 * @returns The mapped transactions.
 */
function mapRows(overrides: readonly object[]): readonly ITransaction[] {
  const rows = overrides.map((o): object => ({ ...BASE_ROW, ...o }));
  const body = { body: { fields: null, table: { rows } } };
  const acct = { index: 0, accountNumber: '99-888777' };
  const ctx = {} as unknown as IActionContext;
  const page = txnsExtractPage({ body, cursor: false, acct, ctx });
  return page.items.map((row): ITransaction => {
    const txn = autoMapTransaction(row as ApiRecord, MIZRAHI_SHAPE.isCardIssuer);
    if (txn === false) throw new TypeError('row was rejected by the mapper');
    return txn;
  });
}

/**
 * The identifier one row maps to.
 * @param override - The row's identifier fields.
 * @returns The mapped identifier.
 */
function identifierOf(override: object): ITransaction['identifier'] {
  const [txn] = mapRows([override]);
  return txn.identifier;
}

describe('Mizrahi transaction identifier', () => {
  it('joins the reference and the movement number of a split reference', () => {
    const id = identifierOf({ MC02AsmahtaMekoritEZ: '999', TransactionNumber: '5' });
    expect(id).toBe('999-5');
  });

  it('accepts a numeric movement number', () => {
    const id = identifierOf({ MC02AsmahtaMekoritEZ: '999', TransactionNumber: 2 });
    expect(id).toBe('999-2');
  });

  it.each([['1'], [1], [null], [undefined]])(
    'publishes the reference as a number for movement number %p',
    txnNo => {
      const id = identifierOf({ MC02AsmahtaMekoritEZ: '55555', TransactionNumber: txnNo });
      expect(id).toBe(55555);
    },
  );

  it('keeps a non-numeric reference as its string', () => {
    const id = identifierOf({ MC02AsmahtaMekoritEZ: 'REF-A', TransactionNumber: '1' });
    expect(id).toBe('REF-A');
  });

  it.each([[''], [null]])('publishes no identifier for reference %p', ref => {
    const id = identifierOf({ MC02AsmahtaMekoritEZ: ref, TransactionNumber: '1' });
    expect(id).toBeUndefined();
  });

  it('keeps two movements that share a reference apart', () => {
    const txns = mapRows([
      { MC02AsmahtaMekoritEZ: '777', TransactionNumber: '1' },
      { MC02AsmahtaMekoritEZ: '777', TransactionNumber: '2' },
    ]);
    const ids = txns.map((t): ITransaction['identifier'] => t.identifier);
    expect(ids).toEqual([777, '777-2']);
  });
});
