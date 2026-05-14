/**
 * Phase G — `detectDedupKeyFields` contract.
 *
 * <p>Pure-function contract — synthetic minimal inputs, NO fixtures
 * (cross-bank happy paths via real-data fixtures are covered
 * end-to-end by `CrossBankDedupFactory.test.ts`).
 *
 * <p>The detector resolves a non-empty tuple deterministically:
 * minimal `['identifier']` when every row has a distinct identifier,
 * composite `['date','identifier','originalAmount']` when any row
 * has an absent or colliding identifier. Empty input defensively
 * returns `['identifier']` (unreachable in production — TxnParser
 * skips the detector when `records.length === 0`).
 *
 * <p>RED today on `main`: the detector module does not exist yet →
 * suite fails to load. GREEN after Phase G's atomic commit lands.
 */

import detectDedupKeyFields from '../../../../../Scrapers/Pipeline/Mediator/Dashboard/DedupKeyFieldsDetector.js';
import type { ITransaction } from '../../../../../Transactions.js';
import { TransactionStatuses, TransactionTypes } from '../../../../../Transactions.js';

/** Frozen default-transaction template — single source of truth for
 *  the per-row fields {@link makeTxn} merges overrides onto. Keeping
 *  the defaults out of the builder body satisfies the per-method
 *  10-line ceiling (CodeRabbit review 2026-05-15). */
const DEFAULT_TXN: Readonly<ITransaction> = Object.freeze({
  type: TransactionTypes.Normal,
  date: '2026-05-10',
  processedDate: '2026-05-10',
  originalAmount: -100,
  originalCurrency: 'ILS',
  chargedAmount: -100,
  description: 'synthetic',
  status: TransactionStatuses.Completed,
  identifier: 'unique-id',
});

/**
 * Minimal `ITransaction` builder. Local to this file because the
 * detector's contract is independent of any cross-test helper.
 * @param overrides - Field overrides.
 * @returns Synthetic transaction.
 */
function makeTxn(overrides: Partial<ITransaction>): ITransaction {
  return { ...DEFAULT_TXN, ...overrides };
}

describe('detectDedupKeyFields — Phase G contract', () => {
  it('DETECTOR-EMPTY-001 detectDedupKeyFields_EmptyInput_ShouldDefaultToIdentifierOnly', (): void => {
    const result = detectDedupKeyFields([]);

    expect(result).toEqual(['identifier']);
  });

  it('DETECTOR-COMPOSITE-001 detectDedupKeyFields_RowMissingIdentifier_ShouldResolveCompositeTuple', (): void => {
    const rows = [
      makeTxn({ identifier: 'A' }),
      makeTxn({ identifier: undefined, date: '2026-05-09' }),
      makeTxn({ identifier: 'B', date: '2026-05-08' }),
    ];

    const result = detectDedupKeyFields(rows);

    expect(result).toEqual(['date', 'identifier', 'originalAmount']);
  });
});
