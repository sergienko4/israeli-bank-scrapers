/**
 * Ring GetTransactionsList rows — unit coverage for the three-container row
 * merge every ring issuer (Isracard, Amex) adopts: approvals + vouchers +
 * out-of-statement (null data, absent containers), and the declared-row
 * reconciliation for that same container. Bodies are synthetic — zero PII.
 */

import { auditDeclaredRows } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/CoverageAudit/DeclaredRows.js';
import {
  mergeRingRows,
  RING_DECLARED_ROWS,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/Ring/RingShapeExtract.js';

/**
 * Build a transactions body carrying only the out-of-statement container —
 * the charge-date-outside-the-cycle rows the ring reads a level deeper than
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

describe('ring three-container merge', () => {
  it('mergeRows joins approvals + vouchers and tolerates absent containers', () => {
    const body = {
      data: {
        approvals: { approvedTransactions: [{ a: 1 }] },
        israelAbroadVouchers: { vouchers: { israelAbroadVouchersList: [{ v: 2 }] } },
      },
    };
    const merged = mergeRingRows(body);
    const emptyData = mergeRingRows({ data: {} });
    expect(merged).toHaveLength(2);
    expect(emptyData).toEqual([]);
  });

  it('mergeRows yields no rows when the data block is null', () => {
    const merged = mergeRingRows({ data: null });
    expect(merged).toEqual([]);
  });

  it('mergeRows includes charges posting outside the statement cycle', () => {
    const body = outOfStatementBody([[{ o: 1 }, { o: 2 }]]);
    const merged = mergeRingRows(body);
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
    const merged = mergeRingRows(body);
    expect(merged).toEqual([{ a: 1 }, { v: 2 }, { o: 3 }]);
  });

  it('mergeRows flattens several per-currency-date groups', () => {
    const body = outOfStatementBody([[{ o: 1 }], [{ o: 2 }, { o: 3 }]]);
    const merged = mergeRingRows(body);
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
    const merged = mergeRingRows(body);
    expect(merged).toEqual([]);
  });

  it('declares the out-of-statement container it reads', () => {
    const paths = RING_DECLARED_ROWS.map((s): string => s.groups);
    expect(paths).toContain('data.israelAbroadVouchers.outOfStatementChargeDateVouchers');
  });

  it('declared rows reconcile against a body that carries what it states', () => {
    const group = {
      totalVouchersCurrencyDate: { countImmediateVouchers: 2 },
      immediateVouchersCurrencyDate: [{ o: 1 }, { o: 2 }],
    };
    const body = { data: { israelAbroadVouchers: { outOfStatementChargeDateVouchers: [group] } } };
    const result = auditDeclaredRows({ body, specs: RING_DECLARED_ROWS, label: 'test/txns' });
    expect(result).toEqual({ checked: 1, shortfall: 0, unavailable: false });
  });

  it('declared rows expose the container omission this suite exists for', () => {
    const group = {
      totalVouchersCurrencyDate: { countImmediateVouchers: 2 },
      immediateVouchersCurrencyDate: [],
    };
    const body = { data: { israelAbroadVouchers: { outOfStatementChargeDateVouchers: [group] } } };
    const result = auditDeclaredRows({ body, specs: RING_DECLARED_ROWS, label: 'test/txns' });
    expect(result.shortfall).toBe(2);
  });
});
