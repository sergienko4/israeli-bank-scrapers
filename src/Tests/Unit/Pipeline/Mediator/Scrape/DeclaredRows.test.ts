/**
 * Declared-row reconciliation — the guardrail that takes the provider at its
 * word.
 *
 * The cases below encode the two claims the module makes. First, a group is
 * only checkable when it states a count, so a body that declares nothing must
 * report zero checks rather than zero shortfall — silence and agreement are
 * different answers, and conflating them would hide a renamed field. Second, a
 * surplus is not a shortfall: extracting more than declared is odd but is not
 * loss, and must never net off against a real gap elsewhere. Bodies are
 * synthetic — zero PII.
 */

import {
  auditDeclaredRows,
  type IDeclaredArgs,
  type IDeclaredRowSpec,
} from '../../../../../Scrapers/Pipeline/Mediator/Scrape/CoverageAudit/DeclaredRows.js';

/** The Isracard/Amex declaration, the only shape measured in the wild. */
const SPEC: IDeclaredRowSpec = {
  groups: 'data.israelAbroadVouchers.outOfStatementChargeDateVouchers',
  rows: 'immediateVouchersCurrencyDate',
  count: 'totalVouchersCurrencyDate.countImmediateVouchers',
};

/**
 * Build one group that declares a count and carries some rows.
 * @param declared - Count the group states, or false to state none.
 * @param carried - Number of rows the group actually holds.
 * @returns A synthetic group node.
 */
function group(declared: number | false, carried: number): Record<string, unknown> {
  const rows = Array.from({ length: carried }, (_, i): object => ({ n: i }));
  const isSilent = declared === false;
  const total = isSilent ? {} : { countImmediateVouchers: declared };
  return { totalVouchersCurrencyDate: total, immediateVouchersCurrencyDate: rows };
}

/**
 * Wrap groups in the container path the spec names.
 * @param groups - Group nodes.
 * @returns A synthetic response body.
 */
function body(groups: readonly object[]): object {
  return { data: { israelAbroadVouchers: { outOfStatementChargeDateVouchers: groups } } };
}

/**
 * Run one reconciliation with the measured spec.
 * @param node - Response body.
 * @returns Declared-row counts.
 */
function audit(node: object): ReturnType<typeof auditDeclaredRows> {
  const args: IDeclaredArgs = { body: node, specs: [SPEC], label: 'test/txns' };
  return auditDeclaredRows(args);
}

describe('Declared/auditDeclaredRows', () => {
  it('checks nothing when the bank declares no spec', () => {
    const node = body([group(3, 3)]);
    const args: IDeclaredArgs = { body: node, specs: [], label: 'test/txns' };
    const result = auditDeclaredRows(args);
    expect(result).toEqual({ checked: 0, shortfall: 0 });
  });

  it('reports no shortfall when carried matches declared', () => {
    const node = body([group(3, 3)]);
    const result = audit(node);
    expect(result.checked).toBe(1);
    expect(result.shortfall).toBe(0);
  });

  it('reports the rows a group declared but did not carry', () => {
    const node = body([group(12, 0)]);
    const result = audit(node);
    expect(result.checked).toBe(1);
    expect(result.shortfall).toBe(12);
  });

  it('sums shortfalls across every group', () => {
    const node = body([group(5, 2), group(4, 4), group(7, 3)]);
    const result = audit(node);
    expect(result.checked).toBe(3);
    expect(result.shortfall).toBe(7);
  });

  it('skips a group that declares no count', () => {
    const node = body([group(false, 9), group(2, 2)]);
    const result = audit(node);
    expect(result.checked).toBe(1);
    expect(result.shortfall).toBe(0);
  });

  it('never nets a surplus against a real shortfall', () => {
    const node = body([group(1, 6), group(8, 3)]);
    const result = audit(node);
    expect(result.shortfall).toBe(5);
  });

  it('checks nothing when the container is absent', () => {
    const result = audit({ data: {} });
    expect(result).toEqual({ checked: 0, shortfall: 0 });
  });

  it('checks nothing when the container is not an array', () => {
    const node = { data: { israelAbroadVouchers: { outOfStatementChargeDateVouchers: {} } } };
    const result = audit(node);
    expect(result).toEqual({ checked: 0, shortfall: 0 });
  });

  it('treats a group carrying no row array as carrying nothing', () => {
    const node = body([{ totalVouchersCurrencyDate: { countImmediateVouchers: 4 } }]);
    const result = audit(node);
    expect(result.shortfall).toBe(4);
  });

  it('ignores a count that is not a finite number', () => {
    const node = body([{ totalVouchersCurrencyDate: { countImmediateVouchers: '4' } }]);
    const result = audit(node);
    expect(result).toEqual({ checked: 0, shortfall: 0 });
  });

  it('reconciles every declaration a bank names', () => {
    const other: IDeclaredRowSpec = { groups: 'data.more', rows: 'items', count: 'total' };
    const node = { data: { more: [{ total: 5, items: [{ n: 1 }] }] } };
    const args: IDeclaredArgs = { body: node, specs: [SPEC, other], label: 'test/txns' };
    const result = auditDeclaredRows(args);
    expect(result).toEqual({ checked: 1, shortfall: 4 });
  });
});
