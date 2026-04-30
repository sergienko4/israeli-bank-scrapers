/**
 * ScrapeAutoMapper — WK.direction sign-convention tests.
 * Generic: any bank whose API emits DEBIT / CREDIT markers gets the correct sign.
 * Back-compat: records without a direction field keep their sign unchanged.
 */

import { extractTransactions } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapeAutoMapper.js';

/** Wrap raw movements into the root-array shape findFirstArray understands. */
interface IWrapArgs {
  readonly movements: readonly Record<string, unknown>[];
}

/**
 * Build an envelope that the mapper will recognise as a transaction array.
 * @param args - The movements array to embed.
 * @returns Envelope shape with a container the mapper can find.
 */
function buildEnvelope(args: IWrapArgs): Record<string, unknown> {
  return { movements: args.movements };
}

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

describe('ScrapeAutoMapper/WKDirection', () => {
  it('creditDebit="DEBIT" inverts positive amount to negative', () => {
    const envelope = buildEnvelope({ movements: [buildMovement(150, 'DEBIT')] });
    const txns = extractTransactions(envelope);
    expect(txns.length).toBe(1);
    expect(txns[0].chargedAmount).toBe(-150);
  });

  it('creditDebit="CREDIT" keeps positive amount positive', () => {
    const envelope = buildEnvelope({ movements: [buildMovement(200, 'CREDIT')] });
    const txns = extractTransactions(envelope);
    expect(txns.length).toBe(1);
    expect(txns[0].chargedAmount).toBe(200);
  });

  it('direction="debit" (lowercase) also inverts', () => {
    const envelope = {
      movements: [
        {
          movementId: 'm-2',
          movementTimestamp: '2026-01-15T10:00:00',
          movementAmount: 75,
          direction: 'debit',
        },
      ],
    };
    const txns = extractTransactions(envelope);
    expect(txns.length).toBe(1);
    expect(txns[0].chargedAmount).toBe(-75);
  });

  it('debitCreditIndicator="DEBIT" alias also inverts', () => {
    const envelope = {
      movements: [
        {
          movementId: 'm-3',
          movementTimestamp: '2026-01-15T10:00:00',
          movementAmount: 42,
          debitCreditIndicator: 'DEBIT',
        },
      ],
    };
    const txns = extractTransactions(envelope);
    expect(txns.length).toBe(1);
    expect(txns[0].chargedAmount).toBe(-42);
  });

  it('records without any direction field leave sign unchanged (back-compat)', () => {
    const envelope = buildEnvelope({ movements: [buildMovement(90)] });
    const txns = extractTransactions(envelope);
    expect(txns.length).toBe(1);
    expect(txns[0].chargedAmount).toBe(90);
  });
});
