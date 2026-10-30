/**
 * Amex DigitalV3 + ring shapes — cross-bank unit coverage for the Amex
 * GetCardList customer step and the three-container transactions row merge.
 * Amex's web path and the ring issuers (Isracard) read the identical
 * GetTransactionsList response, so ONE `describe.each` over both mergers
 * exercises the approvals+vouchers+out-of-statement merge (null data, absent
 * containers) and the declared-row reconciliation both adopt for that same
 * container. Bodies are synthetic — zero PII.
 */

import * as amexE from '../../../../Scrapers/Pipeline/Banks/Amex/scrape/AmexShapeExtract.js';
import * as amexH from '../../../../Scrapers/Pipeline/Banks/Amex/scrape/AmexShapeHelpers.js';
import type { IDeclaredRowSpec } from '../../../../Scrapers/Pipeline/Mediator/Scrape/CoverageAudit/DeclaredRows.js';
import { auditDeclaredRows } from '../../../../Scrapers/Pipeline/Mediator/Scrape/CoverageAudit/DeclaredRows.js';
import type { IExtractAccountsArgs } from '../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import * as ringE from '../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/Ring/RingShapeExtract.js';

interface ICard {
  readonly cardSuffix: string;
  readonly companyCode: string;
}

interface IDigitalV3Mod {
  extractCards(a: IExtractAccountsArgs): readonly ICard[];
  accountNumberOf(c: ICard): string;
  customerVars(): Record<string, unknown>;
  customerUrl(): string;
  primeUrl(): string;
  noVars(): object;
}

interface IMerger {
  readonly name: string;
  readonly mergeRows: (body: object) => readonly object[];
  readonly declared: readonly IDeclaredRowSpec[];
}

const AMEX = amexH as unknown as IDigitalV3Mod;
const AMEX_API = amexH.AMEX_API;

const MERGERS: readonly IMerger[] = [
  { name: 'Amex', mergeRows: amexE.mergeAmexRows, declared: amexE.AMEX_DECLARED_ROWS },
  { name: 'Ring', mergeRows: ringE.mergeRingRows, declared: ringE.RING_DECLARED_ROWS },
];

/**
 * Wrap a customer/transactions body into extract-accounts args.
 * @param body - Synthetic response body.
 * @returns Extract-accounts args.
 */
function cardsArgs(body: object): IExtractAccountsArgs {
  return { body, sessionContext: {} } as unknown as IExtractAccountsArgs;
}

/**
 * Build a transactions body carrying only the out-of-statement container —
 * the charge-date-outside-the-cycle rows both banks read a level deeper than
 * the settled voucher list.
 * @param groups - Per-currency-date groups, each a list of rows.
 * @returns GetTransactionsList response body.
 */
function outOfStatementBody(groups: readonly (readonly object[])[]): object {
  const wrapped = groups.map((rows): object => ({ immediateVouchersCurrencyDate: rows }));
  const israelAbroadVouchers = {
    vouchers: { israelAbroadVouchersList: [] },
    outOfStatementChargeDateVouchers: wrapped,
  };
  return { data: { israelAbroadVouchers } };
}

describe('Amex DigitalV3 card list', () => {
  it('extractCards parses the string-encoded cardsList', () => {
    const body = { data: { cardsList: JSON.stringify([{ cardSuffix: '1234', companyCode: 77 }]) } };
    const args = cardsArgs(body);
    const cards = AMEX.extractCards(args);
    expect(cards).toEqual([{ cardSuffix: '1234', companyCode: '77' }]);
  });

  it('extractCards passes an array cardsList through and defaults missing fields', () => {
    const body = { data: { cardsList: [{}] } };
    const args = cardsArgs(body);
    const cards = AMEX.extractCards(args);
    expect(cards).toEqual([{ cardSuffix: '', companyCode: '' }]);
  });

  it('extractCards yields no cards for a malformed, absent, or null cardsList', () => {
    const malformedArgs = cardsArgs({ data: { cardsList: 'not-json{' } });
    const absentArgs = cardsArgs({ data: {} });
    const nullArgs = cardsArgs({ data: { cardsList: null } });
    const malformed = AMEX.extractCards(malformedArgs);
    const absent = AMEX.extractCards(absentArgs);
    const nulled = AMEX.extractCards(nullArgs);
    expect(malformed).toEqual([]);
    expect(absent).toEqual([]);
    expect(nulled).toEqual([]);
  });

  it('extractCards yields no cards when the JSON payload is not an array', () => {
    const args = cardsArgs({ data: { cardsList: '{"x":1}' } });
    const cards = AMEX.extractCards(args);
    expect(cards).toEqual([]);
  });

  it('customer step targets GetCardList with the fixed query body', () => {
    const vars = AMEX.customerVars();
    const url = AMEX.customerUrl();
    const prime = AMEX.primeUrl();
    const emptyVars = AMEX.noVars();
    const number = AMEX.accountNumberOf({ cardSuffix: '1234', companyCode: '77' });
    expect(vars).toEqual({ companyCode: '99', cardSuffixLength: 4 });
    expect(url).toContain(`${AMEX_API}/ocp/transactions/DigitalV3.Transactions/GetCardList`);
    expect(prime).toBe(`${AMEX_API}/transactions`);
    expect(emptyVars).toEqual({});
    expect(number).toBe('1234');
  });
});

describe.each(MERGERS)('$name three-container merge', bank => {
  it('mergeRows joins approvals + vouchers and tolerates absent containers', () => {
    const body = {
      data: {
        approvals: { approvedTransactions: [{ a: 1 }] },
        israelAbroadVouchers: { vouchers: { israelAbroadVouchersList: [{ v: 2 }] } },
      },
    };
    const merged = bank.mergeRows(body);
    const emptyData = bank.mergeRows({ data: {} });
    expect(merged).toHaveLength(2);
    expect(emptyData).toEqual([]);
  });

  it('mergeRows yields no rows when the data block is null', () => {
    const merged = bank.mergeRows({ data: null });
    expect(merged).toEqual([]);
  });

  it('mergeRows includes charges posting outside the statement cycle', () => {
    const body = outOfStatementBody([[{ o: 1 }, { o: 2 }]]);
    const merged = bank.mergeRows(body);
    expect(merged).toHaveLength(2);
  });

  it('mergeRows joins all three containers into one list', () => {
    const body = {
      data: {
        approvals: { approvedTransactions: [{ a: 1 }] },
        israelAbroadVouchers: {
          vouchers: { israelAbroadVouchersList: [{ v: 2 }] },
          outOfStatementChargeDateVouchers: [{ immediateVouchersCurrencyDate: [{ o: 3 }] }],
        },
      },
    };
    const merged = bank.mergeRows(body);
    expect(merged).toEqual([{ a: 1 }, { v: 2 }, { o: 3 }]);
  });

  it('mergeRows flattens several per-currency-date groups', () => {
    const body = outOfStatementBody([[{ o: 1 }], [{ o: 2 }, { o: 3 }]]);
    const merged = bank.mergeRows(body);
    expect(merged).toHaveLength(3);
  });

  it('mergeRows tolerates an out-of-statement group whose row list is null', () => {
    const body = {
      data: {
        israelAbroadVouchers: {
          vouchers: { israelAbroadVouchersList: [] },
          outOfStatementChargeDateVouchers: [{ immediateVouchersCurrencyDate: null }],
        },
      },
    };
    const merged = bank.mergeRows(body);
    expect(merged).toEqual([]);
  });

  it('declares the out-of-statement container it reads', () => {
    const paths = bank.declared.map((s): string => s.groups);
    expect(paths).toContain('data.israelAbroadVouchers.outOfStatementChargeDateVouchers');
  });

  it('declared rows reconcile against a body that carries what it states', () => {
    const group = {
      totalVouchersCurrencyDate: { countImmediateVouchers: 2 },
      immediateVouchersCurrencyDate: [{ o: 1 }, { o: 2 }],
    };
    const body = { data: { israelAbroadVouchers: { outOfStatementChargeDateVouchers: [group] } } };
    const result = auditDeclaredRows({ body, specs: bank.declared, label: 'test/txns' });
    expect(result).toEqual({ checked: 1, shortfall: 0, unavailable: false });
  });

  it('declared rows expose the container omission this suite exists for', () => {
    const group = {
      totalVouchersCurrencyDate: { countImmediateVouchers: 2 },
      immediateVouchersCurrencyDate: [],
    };
    const body = { data: { israelAbroadVouchers: { outOfStatementChargeDateVouchers: [group] } } };
    const result = auditDeclaredRows({ body, specs: bank.declared, label: 'test/txns' });
    expect(result.shortfall).toBe(2);
  });
});
