/**
 * OtpBudget — counts the SMS messages one real-E2E run has cost, so the
 * harness can stop before it buys another.
 *
 * <p>The production cap (`TokenStrategyFromConfig.budget.ts`) holds one scrape
 * to a single cold login. It cannot see further than that, because the warm
 * fallback answers a rejection by building a *second* scraper — new strategy,
 * new slot, full budget — and a second scraper is entitled to a second
 * message. Only the harness sits above both attempts, so only the harness can
 * count across them.
 *
 * <p>Counting is per retriever *instance*, not per call: a multi-step login
 * (PayBox confirms the same code twice) submits one delivered message several
 * times, and charging each submission would read two SMS where the phone
 * buzzed once.
 */

import { createOtpBudget } from '../E2eReal/OtpBudget.js';

/** Digits a delivered message carries. */
const CODE = '481902';
/** The hint a bank passes to its retriever. */
const HINT = '+972-5X-XXX-1234';

/** Local error type — the house rule bans a bare `throw new Error()`. */
class OtpBudgetTestError extends Error {}

/**
 * A retriever that answers every call with the delivered digits.
 * @returns The delivered code.
 */
async function deliversCode(): Promise<string> {
  await Promise.resolve();
  return CODE;
}

/**
 * A retriever that never answers — the shape of an SMS that was sent but
 * never arrived, or a poll that timed out waiting for it.
 * @throws Always, to model an acquisition that fails after delivery.
 */
async function neverArrives(): Promise<string> {
  await Promise.resolve();
  throw new OtpBudgetTestError('no message arrived before the deadline');
}

describe('createOtpBudget', (): void => {
  it('starts a run owing nothing', (): void => {
    const budget = createOtpBudget();
    const spent = budget.spent();
    expect(spent).toBe(0);
  });

  it('hands back the code the retriever resolved', async (): Promise<void> => {
    const budget = createOtpBudget();
    const metered = budget.meter(deliversCode);
    const code = await metered(HINT);
    expect(code).toBe(CODE);
  });

  it('passes the bank hint through untouched', async (): Promise<void> => {
    const budget = createOtpBudget();
    const seen: (string | undefined)[] = [];
    /**
     * Record the hint this retriever was given.
     * @param hint - Phone hint supplied by the bank.
     * @returns The delivered code.
     */
    async function recordsHint(hint?: string): Promise<string> {
      await Promise.resolve();
      seen.push(hint);
      return CODE;
    }
    const metered = budget.meter(recordsHint);
    await metered(HINT);
    expect(seen).toEqual([HINT]);
  });

  it('charges one message for one acquisition', async (): Promise<void> => {
    const budget = createOtpBudget();
    const metered = budget.meter(deliversCode);
    await metered(HINT);
    const spent = budget.spent();
    expect(spent).toBe(1);
  });

  it('charges one message however often that code is resubmitted', async (): Promise<void> => {
    const budget = createOtpBudget();
    const metered = budget.meter(deliversCode);
    await metered(HINT);
    await metered(HINT);
    await metered(HINT);
    const spent = budget.spent();
    expect(spent).toBe(1);
  });

  it('charges each retriever separately — one phone buzz apiece', async (): Promise<void> => {
    const budget = createOtpBudget();
    const first = budget.meter(deliversCode);
    const second = budget.meter(deliversCode);
    await first(HINT);
    await second(HINT);
    const spent = budget.spent();
    expect(spent).toBe(2);
  });

  it('charges a message that was sent but never collected', async (): Promise<void> => {
    const budget = createOtpBudget();
    const metered = budget.meter(neverArrives);
    const pending = metered(HINT);
    await expect(pending).rejects.toThrow('no message arrived');
    const spent = budget.spent();
    expect(spent).toBe(1);
  });

  it('owes nothing for a retriever that was built but never asked', (): void => {
    const budget = createOtpBudget();
    budget.meter(deliversCode);
    const spent = budget.spent();
    expect(spent).toBe(0);
  });
});
