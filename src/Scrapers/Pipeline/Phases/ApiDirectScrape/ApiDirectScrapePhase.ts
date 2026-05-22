/**
 * ApiDirectScrape phase — post-login data fetch via the configured
 * IApiDirectScrapeShape. PRE resolves the api mediator, ACTION
 * walks customer → per-account (balance + paginated txns), POST
 * validates the accounts have balances + at-least-one txn page,
 * FINAL emits the structured trace event and merges the
 * IScrapeAccount[] into the pipeline context.
 *
 * Zero bank-name coupling per Rule #11. The bank's SHAPE config
 * is supplied by the PipelineBuilder via withApiDirectScrape(SHAPE).
 *
 * Commit A: SCAFFOLD only. Commit B fills in the real ACTION body.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { IActionContext, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail } from '../../Types/Procedure.js';

const SCAFFOLD_MESSAGE = 'ApiDirectScrape phase not yet implemented (Commit A scaffold)';

/**
 * Reject the call with a deterministic Generic failure.
 *
 * Commit A returns this failure unconditionally so the phase cannot
 * be wired into a real pipeline before Commit B lands the actual
 * driver body. The ctx parameter is retained so the eventual
 * driver signature remains stable across commits A → B.
 *
 * @param ctx - Action context supplied by the pipeline executor.
 * @returns Generic failure result with the scaffold message.
 */
async function runApiDirectScrapePhase(ctx: IActionContext): Promise<Procedure<IPipelineContext>> {
  await Promise.resolve(ctx);
  const failure = fail(ScraperErrorTypes.Generic, SCAFFOLD_MESSAGE);
  return failure;
}

export default runApiDirectScrapePhase;
export { runApiDirectScrapePhase };
