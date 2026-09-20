/**
 * OtpBudget — counts the SMS messages a single real-E2E run has cost.
 *
 * <p>The production cap holds one scrape to one cold login
 * (`TokenStrategyFromConfig.budget.ts`). It cannot reach further, because the
 * warm fallback answers a rejection by constructing a *second* scraper: new
 * strategy, new capture slot, full budget. That second scraper is entitled to
 * its own message, and it is right to be — it has no way of knowing another
 * attempt already happened. Only the harness spans both attempts, so only the
 * harness can hold the run as a whole to a single message.
 *
 * <p>Charging is per retriever *instance* rather than per call. A multi-step
 * login submits one delivered code several times — PayBox confirms the same
 * digits at `/pinValidation` and again at `/loginBySms` — and charging each
 * submission would report two messages where the phone buzzed once.
 *
 * <p>A failed acquisition is still charged. By the time a retriever is asked,
 * the bank has already sent the message; whether the poller managed to collect
 * it before its deadline changes nothing about the user's phone.
 */

/** The credential-side OTP callback, as `ScraperCredentials` declares it. */
type OtpRetriever = (phoneHint?: string) => Promise<string>;

/** Meter over a run's OTP acquisitions. */
interface IOtpBudget {
  /**
   * Wrap a retriever so its first use is charged to this run.
   * @param retriever - The underlying retriever.
   * @returns A transparent replacement carrying the same contract.
   */
  meter(retriever: OtpRetriever): OtpRetriever;
  /**
   * Messages this run has already cost.
   * @returns The count of distinct retrievers that were actually asked.
   */
  spent(): number;
}

/**
 * Build a budget that counts the messages one run sends.
 * @returns A fresh budget owing nothing.
 */
function createOtpBudget(): IOtpBudget {
  const state = { messages: 0 };
  /**
   * Wrap a retriever so its first invocation charges the run.
   * @param retriever - The underlying retriever.
   * @returns Transparent replacement — same hint in, same result out.
   */
  function meter(retriever: OtpRetriever): OtpRetriever {
    const charge = { hasFired: false };
    /**
     * Charge once, then defer entirely to the wrapped retriever.
     * @param phoneHint - Hint the bank passes through.
     * @returns Whatever the wrapped retriever resolves or rejects with.
     */
    async function metered(phoneHint?: string): Promise<string> {
      if (!charge.hasFired) state.messages = state.messages + 1;
      charge.hasFired = true;
      return retriever(phoneHint);
    }
    return metered;
  }
  /**
   * Read how many messages the run has cost so far.
   * @returns The running count.
   */
  function spent(): number {
    return state.messages;
  }
  return { meter, spent };
}

export type { IOtpBudget, OtpRetriever };
export { createOtpBudget };
