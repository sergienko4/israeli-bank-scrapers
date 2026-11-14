/**
 * TxnMapper — WK.direction sign-convention tests.
 * Generic: any bank whose API emits DEBIT / CREDIT markers gets the correct sign.
 * Back-compat: records without a direction field keep their sign unchanged.
 */

import { autoMapTransaction } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/TxnMapper/TxnMapper.js';
import type { ITransaction } from '../../../../../Transactions.js';

/**
 * Build one raw movement record with amount + optional direction.
 * @param amount - Transaction amount.
 * @param direction - Optional direction marker.
 * @returns Raw record.
 */
function buildMovement(amount: number, direction?: string): Record<string, unknown> {
  const base: Record<string, unknown> = {
    movementId: 'm-1',
    movementTimestamp: '2026-01-15T10:00:00',
    movementAmount: amount,
    movementCurrency: 'ILS',
    description: 'demo',
  };
  if (direction !== undefined) base.creditDebit = direction;
  return base;
}

/**
 * Map one raw record and assert the mapper accepted it.
 * @param raw - Raw movement record.
 * @returns The mapped transaction.
 */
function mapOne(raw: Record<string, unknown>): ITransaction {
  const mapped = autoMapTransaction(raw);
  expect(mapped).not.toBe(false);
  return mapped as ITransaction;
}

describe('TxnMapper/WKDirection', () => {
  it('creditDebit="DEBIT" inverts positive amount to negative', () => {
    const movement = buildMovement(150, 'DEBIT');
    const txn = mapOne(movement);
    expect(txn.chargedAmount).toBe(-150);
  });

  it('creditDebit="CREDIT" keeps positive amount positive', () => {
    const movement = buildMovement(200, 'CREDIT');
    const txn = mapOne(movement);
    expect(txn.chargedAmount).toBe(200);
  });

  it('direction="debit" (lowercase) also inverts', () => {
    const txn = mapOne({
      movementId: 'm-2',
      movementTimestamp: '2026-01-15T10:00:00',
      movementAmount: 75,
      direction: 'debit',
    });
    expect(txn.chargedAmount).toBe(-75);
  });

  it('debitCreditIndicator="DEBIT" alias also inverts', () => {
    const txn = mapOne({
      movementId: 'm-3',
      movementTimestamp: '2026-01-15T10:00:00',
      movementAmount: 42,
      debitCreditIndicator: 'DEBIT',
    });
    expect(txn.chargedAmount).toBe(-42);
  });

  it('records without any direction field leave sign unchanged (back-compat)', () => {
    const movement = buildMovement(90);
    const txn = mapOne(movement);
    expect(txn.chargedAmount).toBe(90);
  });
});
