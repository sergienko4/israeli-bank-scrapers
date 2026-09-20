/**
 * LoginWitness — test-only observer of what a scrape attempt's login did.
 *
 * <p>The warm-path fallback must decide whether retrying can cost a second
 * SMS. Counting OTP-retriever calls is not enough: the bank sends the message
 * at the step *before* the code is collected, so a flow that dies in between
 * spends a message the retriever never sees.
 *
 * <p>`onAuthFlowComplete` is a stronger signal because of where the pipeline
 * fires it. It runs only after a login has actually completed — the ACTION
 * stage gates it behind a successful prime — and it runs again whenever a
 * mid-scrape refresh re-mints the bearer. So the last token it reports
 * distinguishes the three outcomes the fallback cares about:
 *
 * <ul>
 *   <li>nothing reported — no login ever completed, so a cold attempt may have
 *       sent a message and died;</li>
 *   <li>the cached seed reported — the warm path was accepted as-is, which
 *       cannot send a message;</li>
 *   <li>a different token reported — a cold login completed, which did.</li>
 * </ul>
 */

import type { IAuthFlowInfo } from '../../Scrapers/Base/Interface.js';

/** Sink the witness forwards to, typically the token cache's writer. */
type AuthFlowWriter = (info: IAuthFlowInfo) => Promise<void>;

/** Observed record of the long-term tokens a run's logins produced. */
interface ILoginWitness {
  /** Bind this to `ScraperOptions.onAuthFlowComplete` in place of the sink. */
  readonly writer: AuthFlowWriter;
  /** Most recent long-term token reported, or '' when no login completed. */
  readonly lastToken: () => string;
}

/**
 * Wrap an `onAuthFlowComplete` sink so the run can be asked what it minted.
 *
 * <p>The token is recorded before the sink runs, so a sink that throws still
 * leaves the evidence behind — the fallback's refusal must not depend on the
 * cache write succeeding.
 * @param sink - The writer to forward every callback to.
 * @returns Witness wrapping the sink.
 */
function createLoginWitness(sink: AuthFlowWriter): ILoginWitness {
  let latest = '';
  /**
   * Record the reported token, then forward to the sink.
   * @param info - Callback payload from the pipeline.
   * @returns The sink's promise.
   */
  async function writer(info: IAuthFlowInfo): Promise<void> {
    if (info.longTermToken.length > 0) latest = info.longTermToken;
    await sink(info);
  }
  /**
   * Report the most recent long-term token seen.
   * @returns The token, or '' when no login completed.
   */
  function lastToken(): string {
    return latest;
  }
  return { writer, lastToken };
}

export type { AuthFlowWriter, ILoginWitness };
export { createLoginWitness };
