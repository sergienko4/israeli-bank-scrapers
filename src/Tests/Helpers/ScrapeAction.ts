/**
 * Test helper — run the ApiDirectScrape action for a shape without building
 * the full pipeline phase wrapper.
 *
 * <p>Production wires the phase through `buildApiDirectScrapePhase`; this helper
 * exposes the same bound action so a test can drive the scrape function alone.
 */

import { buildApiDirectScrapePhase } from '../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapePhase.js';
import type { ApiDirectScrapeFn } from '../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapeTypes.js';
import type { IApiDirectScrapeShape } from '../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { IActionContext } from '../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../Scrapers/Pipeline/Types/Procedure.js';

/**
 * Bind a shape to the phase action the pipeline would run.
 * @param shape - Bank-supplied shape declaration.
 * @returns The bound action, taking one context.
 */
function runScrapeAction<TAcct, TCursor>(
  shape: IApiDirectScrapeShape<TAcct, TCursor>,
): ApiDirectScrapeFn {
  const phase = buildApiDirectScrapePhase(shape);
  return (ctx: IActionContext): Promise<Procedure<IActionContext>> => phase.action(ctx, ctx);
}

export default runScrapeAction;
