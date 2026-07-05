/**
 * Shared BaNCS (Yahav) request-body fixtures for the transaction-recognition
 * and endpoint-picker unit tests. Consolidated from the two suites so the
 * request-shape fixtures stay aligned as the BaNCS schema evolves.
 *
 * <p>Every value is fabricated — no real account data appears.
 */

/** A fake BaNCS `POST …/account` endpoint URL (no real host). */
export const ACCOUNT_URL = 'https://digital.bank.fake.example/BaNCSDigitalApp/account';

/**
 * Build one BaNCS `OrigDt` date-range bound. Carries a `Ver` sibling (on the
 * bound and inside `OrigDt`) to exercise the recogniser's node-walk skip.
 * @param day - Day-of-month for the bound (fabricated).
 * @param operator - BaNCS range operator (GREATERTHANOREQUAL / …).
 * @returns A synthetic inner-filter record.
 */
function origDtBound(day: number, operator: string): Record<string, unknown> {
  return { Ver: 'x', OrigDt: { Ver: 'x', Day: day, Month: 1, Year: 2026 }, Operator: operator };
}

/**
 * Build a CURRENT_ACCOUNT transactions request body with a from/to range.
 * @returns A synthetic BaNCS transactions request body.
 */
export function txnBody(): Record<string, unknown> {
  const from = origDtBound(1, 'GREATERTHANOREQUAL');
  const to = origDtBound(31, 'LESSTHANOREQUAL');
  return {
    Payload: {
      Operation: 'INQ',
      Category: ['CURRENT_ACCOUNT'],
      Filters: [{ Filters: [from, to] }],
    },
  };
}

/**
 * Build the portfolioBalance request body (Category set, NO Filters).
 * @returns A synthetic BaNCS balance request body.
 */
export function balanceBody(): Record<string, unknown> {
  return { Payload: { Operation: 'INQ', Category: ['portfolioBalance'] } };
}
