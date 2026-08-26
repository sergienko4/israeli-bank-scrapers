/**
 * Coverage reconciliation — the guardrail that catches a bank shape reading
 * fewer containers than its response carries.
 *
 * The cases below encode the three ways a naive reconciler gets this wrong and
 * why this one does not: reference comparison would accuse every transforming
 * extractor of loss, raw-count comparison would collapse a repeated charge into
 * one, and hunting an unnarrowed body would accuse a merged-response bank of
 * losing every other account's rows. Bodies are synthetic — zero PII.
 */

import {
  auditCoverage,
  type ICoverageArgs,
} from '../../../../../Scrapers/Pipeline/Mediator/Scrape/CoverageAudit/CoverageAudit.js';
import { huntTransactionGroups } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/FieldHunt/TxnHunt.js';
import { autoMapTransaction } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/TxnMapper/TxnMapper.js';

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

/**
 * A row belonging to the card under audit.
 * @param name - Merchant name.
 * @param amount - Charged amount.
 * @returns A synthetic row tagged with the audited card.
 */
function mine(name: string, amount: number): Record<string, unknown> {
  return { ...txn(name, amount), shortCardNumber: '1111' };
}

/**
 * A row belonging to a different card in the same merged response.
 * @param name - Merchant name.
 * @param amount - Charged amount.
 * @returns A synthetic row tagged with another card.
 */
function theirs(name: string, amount: number): Record<string, unknown> {
  return { ...txn(name, amount), shortCardNumber: '2222' };
}

/**
 * The merged-response ownership predicate a card issuer declares: rows carry
 * every card, and only card 1111's belong to the account under audit.
 * @param row - Raw row from the merged response.
 * @returns Whether the row belongs to card 1111.
 */
function ownsCard1111(row: object): boolean {
  return (row as { shortCardNumber?: string }).shortCardNumber === '1111';
}

/**
 * Run a round for a merged-response bank, narrowing hunted rows to card 1111.
 * @param body - Response body carrying every card.
 * @param extracted - Rows the shape returned for this card.
 * @returns Coverage counts.
 */
function auditOwned(body: object, extracted: readonly object[]): ReturnType<typeof auditCoverage> {
  return auditCoverage({ body, extracted, label: 'max/txns', ownsRow: ownsCard1111 });
}

/**
 * A row in a provider vocabulary the canonical mapper does not recognise —
 * PayBox's `ts` / `amt` / `merchantName`, which carries no WK date or amount
 * alias and so maps to nothing on its own.
 * @param name - Merchant name.
 * @param amount - Unsigned magnitude, as PayBox sends it.
 * @returns A synthetic raw row.
 */
function payBoxish(name: string, amount: number): Record<string, unknown> {
  return { transactionId: name, ts: '2026-06-02T09:00:00.000Z', merchantName: name, amt: amount };
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

  it('reports the second of two identical transactions in one container', () => {
    // A repeated charge is two transactions, not one. Comparing distinct keys
    // would let the shape return either one of them and still read as complete,
    // which is the loss this guardrail exists to surface.
    const rows = [txn('SHOP', 10), txn('SHOP', 10)];
    const result = audit({ data: { list: rows } }, [rows[0]]);
    expect(result.hunted).toBe(2);
    expect(result.unread).toBe(1);
  });

  it('does not double-count a transaction cross-listed in two containers', () => {
    // The same charge appearing in a summary list and a detail list is one
    // transaction. Counting both occurrences would accuse a correct shape.
    const row = txn('SHOP', 10);
    const body = { data: { summary: [row, txn('CAFE', 20)], detail: [{ ...row }] } };
    const result = audit(body, [row, txn('CAFE', 20)]);
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
    expect(result.unaudited).toBe(false);
  });

  it('refuses to call a round complete when it hunted nothing to compare', () => {
    // Measured live on PayBox: `complete (extracted=43 hunted=0)`. An empty hunt
    // set folds `unread` to zero, so the round reads exactly like a clean
    // reconciliation while having proven nothing at all. A shape in this state
    // can drop a whole container and still log green.
    const rows = [txn('SHOP', 10), txn('CAFE', 20)];
    const result = audit({ data: { errorCode: '0' } }, rows);
    expect(result.extracted).toBe(2);
    expect(result.hunted).toBe(0);
    expect(result.unaudited).toBe(true);
  });

  it('reports UNAUDITED when the body speaks a vocabulary the mapper cannot read', () => {
    // The live PayBox failure in miniature, and the reason the verdict is needed
    // rather than merely nice: the body is full of transactions, the shape read
    // every one of them, and the round still compares against nothing because
    // the hunted rows name their fields `ts` / `amt`. Both sides are healthy;
    // only the audit is blind. `unread === 0` here means "proven nothing".
    const raw = [payBoxish('SHOP', 10), payBoxish('CAFE', 20)];
    const extracted = [txn('SHOP', 10), txn('CAFE', 20)];
    const result = audit({ content: { nc: raw } }, extracted);
    expect(result.hunted).toBe(0);
    expect(result.unread).toBe(0);
    expect(result.unaudited).toBe(true);
  });

  it('reports UNAUDITED when neither side survived the comparability filter', () => {
    // The same blindness one step further along: a shape that hands back rows
    // still in the provider's vocabulary leaves *both* sides unmappable, so the
    // mapped extracted total folds to zero too. Keying the verdict off that
    // total would read the round as an empty response and log `complete
    // (extracted=0 hunted=0)` — the identical false green, reached by a second
    // route. The shape returned rows, so there was something to prove.
    const rows = [payBoxish('SHOP', 10), payBoxish('CAFE', 20)];
    const result = audit({ content: { nc: rows } }, rows);
    expect(result.extracted).toBe(0);
    expect(result.hunted).toBe(0);
    expect(result.unaudited).toBe(true);
  });

  it('reaches those rows and rejects them, rather than never finding them', () => {
    // Pins the mechanism the case above only observes the outcome of. Without
    // this, the same totals would appear if the hunter simply stopped
    // recognising PayBox containers — a different defect with an identical
    // signature. Asserting both halves separates "found, then unreadable" from
    // "never found", which is what decides where the eventual repair belongs.
    const raw = [payBoxish('SHOP', 10), payBoxish('CAFE', 20)];
    const groups = huntTransactionGroups({ content: { nc: raw } });
    const found = groups.flat();
    const mapped = autoMapTransaction(raw[0]);
    expect(found).toHaveLength(2);
    expect(mapped).toBe(false);
  });

  it('does not accuse a merged-response bank of losing another card rows', () => {
    // Max returns every card merged and its extractor narrows to one card, so
    // hunted > extracted is that bank's correct steady state. Without the
    // declared predicate this warns on every page of every run, forever.
    const body = { result: { transactions: [mine('SHOP', 10), theirs('CAFE', 20)] } };
    const result = auditOwned(body, [mine('SHOP', 10)]);
    expect(result.hunted).toBe(1);
    expect(result.unread).toBe(0);
  });

  it('still reports a container a merged-response bank never read', () => {
    // Narrowing must not cost the guardrail its teeth: a container the shape
    // skipped is still hunted, and its rows for this card still count as loss.
    const seen = mine('SHOP', 10);
    const body = {
      result: { transactions: [seen, theirs('CAFE', 20)] },
      pending: [mine('GYM', 40)],
    };
    const result = auditOwned(body, [seen]);
    expect(result.unread).toBe(1);
  });
});
