/**
 * ApiDirectScrape phase — post-login data fetch via the configured
 * IApiDirectScrapeShape. The phase is a thin orchestration wrapper:
 * the real work (customer → per-account balance + paginated txns,
 * row mapping, context merge) lives in ApiDirectScrapeActions so
 * the per-file LOC ceiling is respected.
 *
 * Zero bank-name coupling per Rule #11. The bank's SHAPE config
 * is supplied by the PipelineBuilder via withApiDirectScrape(SHAPE)
 * in Commit E. Commits B → D port the body; the builder wire-up
 * lands in Commit E.
 */

import type { IHeadlessScrapeShape } from '../../Banks/_Shared/HeadlessScrapeShape.js';
import type { IActionContext, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { buildGenericHeadlessScrape } from './ApiDirectScrapeActions.js';

/** Bound phase signature consumed by the pipeline executor. */
export type ApiDirectScrapeFn = (ctx: IActionContext) => Promise<Procedure<IPipelineContext>>;

/**
 * Bind a SHAPE to the ApiDirectScrape phase, returning the bound
 * function the pipeline executor invokes per scrape run.
 *
 * @param shape - Bank-supplied shape declaration (data only).
 * @returns Phase function that performs the scrape against the
 *   supplied shape and emits the structured trace events.
 */
function createApiDirectScrapePhase<TAcct, TCursor>(
  shape: IHeadlessScrapeShape<TAcct, TCursor>,
): ApiDirectScrapeFn {
  return buildGenericHeadlessScrape(shape);
}

export default createApiDirectScrapePhase;
export { createApiDirectScrapePhase };
