/**
 * Amex + Isracard DigitalV3 hard-model shapes — cross-bank unit coverage for
 * the shared GetCardList customer step + the three-container transactions row
 * merge. Both banks ride the identical Isracard-issued DigitalV3 backbone, so
 * ONE `describe.each` over the pair exercises card-list parsing (string-encoded
 * array, malformed, non-array, missing fields) and the
 * approvals+vouchers+out-of-statement merge (null data, absent containers), plus
 * the declared-row reconciliation both banks adopt for that same container.
 * Bodies are synthetic — zero PII.
 */

import * as amexE from '../../../../Scrapers/Pipeline/Banks/Amex/scrape/AmexShapeExtract.js';
import * as amexH from '../../../../Scrapers/Pipeline/Banks/Amex/scrape/AmexShapeHelpers.js';
import * as isracardE from '../../../../Scrapers/Pipeline/Banks/Isracard/scrape/IsracardShapeExtract.js';
import * as isracardH from '../../../../Scrapers/Pipeline/Banks/Isracard/scrape/IsracardShapeHelpers.js';
import type { IDeclaredRowSpec } from '../../../../Scrapers/Pipeline/Mediator/Scrape/CoverageAudit/DeclaredRows.js';
import { auditDeclaredRows } from '../../../../Scrapers/Pipeline/Mediator/Scrape/CoverageAudit/DeclaredRows.js';
import type { IExtractAccountsArgs } from '../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';

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
  mergeRows(body: object): readonly object[];
}

interface IBank {
  readonly name: string;
  readonly api: string;
  readonly mod: IDigitalV3Mod;
  readonly declared: readonly IDeclaredRowSpec[];
}

/**
 * Combine a DigitalV3 bank's helpers + row-merge into one accessor.
 * @param h - Helpers module namespace.
 * @param merge - The bank's transactions row-merge function.
 * @returns Uniform DigitalV3 module.
 */
function asMod(h: object, merge: (body: object) => readonly object[]): IDigitalV3Mod {
  return Object.assign({}, h, { mergeRows: merge }) as unknown as IDigitalV3Mod;
}

const BANKS: readonly IBank[] = [
  {
    name: 'Amex',
    api: amexH.AMEX_API,
    mod: asMod(amexH, amexE.mergeAmexRows),
    declared: amexE.AMEX_DECLARED_ROWS,
  },
  {
    name: 'Isracard',
    api: isracardH.ISRACARD_API,
    mod: asMod(isracardH, isracardE.mergeIsracardRows),
    declared: isracardE.ISRACARD_DECLARED_ROWS,
  },
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

describe.each(BANKS)('$name DigitalV3 shape', bank => {
  it('extractCards parses the string-encoded cardsList', () => {
    const body = { data: { cardsList: JSON.stringify([{ cardSuffix: '1234', companyCode: 77 }]) } };
    const args = cardsArgs(body);
    const cards = bank.mod.extractCards(args);
    expect(cards).toEqual([{ cardSuffix: '1234', companyCode: '77' }]);
  });

  it('extractCards passes an array cardsList through and defaults missing fields', () => {
    const body = { data: { cardsList: [{}] } };
    const args = cardsArgs(body);
    const cards = bank.mod.extractCards(args);
    expect(cards).toEqual([{ cardSuffix: '', companyCode: '' }]);
  });

  it('extractCards yields no cards for a malformed, absent, or null cardsList', () => {
    const malformedArgs = cardsArgs({ data: { cardsList: 'not-json{' } });
    const absentArgs = cardsArgs({ data: {} });
    const nullArgs = cardsArgs({ data: { cardsList: null } });
    const malformed = bank.mod.extractCards(malformedArgs);
    const absent = bank.mod.extractCards(absentArgs);
    const nulled = bank.mod.extractCards(nullArgs);
    expect(malformed).toEqual([]);
    expect(absent).toEqual([]);
    expect(nulled).toEqual([]);
  });

  it('extractCards yields no cards when the JSON payload is not an array', () => {
    const args = cardsArgs({ data: { cardsList: '{"x":1}' } });
    const cards = bank.mod.extractCards(args);
    expect(cards).toEqual([]);
  });

  it('customer step targets GetCardList with the fixed query body', () => {
    const vars = bank.mod.customerVars();
    const url = bank.mod.customerUrl();
    const prime = bank.mod.primeUrl();
    const emptyVars = bank.mod.noVars();
    const number = bank.mod.accountNumberOf({ cardSuffix: '1234', companyCode: '77' });
    expect(vars).toEqual({ companyCode: '99', cardSuffixLength: 4 });
    expect(url).toContain(`${bank.api}/ocp/transactions/DigitalV3.Transactions/GetCardList`);
    expect(prime).toBe(`${bank.api}/transactions`);
    expect(emptyVars).toEqual({});
    expect(number).toBe('1234');
  });

  it('mergeRows joins approvals + vouchers and tolerates absent containers', () => {
    const body = {
      data: {
        approvals: { approvedTransactions: [{ a: 1 }] },
        israelAbroadVouchers: { vouchers: { israelAbroadVouchersList: [{ v: 2 }] } },
      },
    };
    const merged = bank.mod.mergeRows(body);
    const emptyData = bank.mod.mergeRows({ data: {} });
    expect(merged).toHaveLength(2);
    expect(emptyData).toEqual([]);
  });

  it('mergeRows yields no rows when the data block is null', () => {
    const merged = bank.mod.mergeRows({ data: null });
    expect(merged).toEqual([]);
  });

  it('mergeRows includes charges posting outside the statement cycle', () => {
    const body = outOfStatementBody([[{ o: 1 }, { o: 2 }]]);
    const merged = bank.mod.mergeRows(body);
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
    const merged = bank.mod.mergeRows(body);
    expect(merged).toEqual([{ a: 1 }, { v: 2 }, { o: 3 }]);
  });

  it('mergeRows flattens several per-currency-date groups', () => {
    const body = outOfStatementBody([[{ o: 1 }], [{ o: 2 }, { o: 3 }]]);
    const merged = bank.mod.mergeRows(body);
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
    const merged = bank.mod.mergeRows(body);
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
    expect(result).toEqual({ checked: 1, shortfall: 0 });
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
