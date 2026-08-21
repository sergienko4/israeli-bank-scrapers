/**
 * Coverage reconciliation — the guardrail that catches a bank shape reading
 * fewer containers than its response carries.
 *
 * The cases below encode the two ways a naive reconciler gets this wrong and
 * why this one does not: reference comparison would accuse every transforming
 * extractor of loss, and raw-count comparison would accuse every legitimately
 * filtering extractor of loss. Bodies are synthetic — zero PII.
 */

import {
  auditCoverage,
  type ICoverageArgs,
} from '../../../../../Scrapers/Pipeline/Mediator/Scrape/CoverageAudit/CoverageAudit.js';

/**
 * One transaction row in the shape the auto-mapper recognises.
 * @param name - Merchant name, the row's identity in the mapped key.
 * @param amount - Charged amount.
 * @returns A synthetic row.
 */
function txn(name: string, amount: number): Record<string, unknown> {
  return { purchaseDate: '2026-06-02', businessName: name, billingAmount: amount };
}

/**
 * Run a reconciliation round with a fixed label.
 * @param body - Response body.
 * @param extracted - Rows the shape returned.
 * @returns Coverage counts.
 */
function audit(body: object, extracted: readonly object[]): ReturnType<typeof auditCoverage> {
  const args: ICoverageArgs = { body, extracted, label: 'test/txns' };
  return auditCoverage(args);
}

describe('Coverage/auditCoverage', () => {
  it('reports no loss when the shape read every container', () => {
    const rows = [txn('SHOP', 10), txn('CAFE', 20)];
    const result = audit({ data: { list: rows } }, rows);
    expect(result.unread).toBe(0);
    expect(result.extracted).toBe(2);
  });

  it('reports the rows left in a container the shape never read', () => {
    const read = [txn('SHOP', 10)];
    const skipped = [txn('STREAMING CO', 30), txn('CLOUD CO', 40)];
    const body = { data: { readList: read, unreadList: skipped } };
    const result = audit(body, read);
    expect(result.unread).toBe(2);
  });

  it('does not accuse a transforming extractor of losing rows', () => {
    const raw = [txn('SHOP', 10), txn('CAFE', 20)];
    const normalised = raw.map((r): Record<string, unknown> => ({ ...r, addedByMapper: true }));
    const result = audit({ data: { list: raw } }, normalised);
    expect(result.unread).toBe(0);
  });

  it('ignores rows the mapper rejects as non-transactions', () => {
    const rows = [txn('SHOP', 10)];
    const noise = [{ fieldName: 'accountId', type: 'string' }, { totalOnly: 999 }];
    const body = { data: { list: rows, schema: noise } };
    const result = audit(body, rows);
    expect(result.unread).toBe(0);
  });

  it('counts distinct transactions, not repeated container entries', () => {
    const row = txn('SHOP', 10);
    const body = { data: { listA: [row], listB: [{ ...row }] } };
    const result = audit(body, [row]);
    expect(result.hunted).toBe(1);
    expect(result.unread).toBe(0);
  });

  it('leaves the extracted rows untouched', () => {
    const read = [txn('SHOP', 10)];
    const body = { data: { readList: read, unreadList: [txn('STREAMING CO', 30)] } };
    audit(body, read);
    expect(read).toHaveLength(1);
  });

  it('reports nothing discoverable for a body with no transactions', () => {
    const result = audit({ data: { errorCode: '0' } }, []);
    expect(result.hunted).toBe(0);
    expect(result.unread).toBe(0);
  });
});
