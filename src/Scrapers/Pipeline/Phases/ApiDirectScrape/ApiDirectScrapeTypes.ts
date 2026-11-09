/**
 * ApiDirectScrape shared types — extracted so ApiDirectScrapeActions and
 * ApiDirectScrapePhase both depend on this leaf module instead of each
 * other, breaking the Actions<->Phase import cycle.
 */

import type { IActionContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';

/** Context returned by the shape-driven scrape function, `scrape` slot committed. */
export type ApiDirectScrapeResult = IActionContext;

/** Bound phase action — the shape-driven scrape function. */
export type ApiDirectScrapeFn = (ctx: IActionContext) => Promise<Procedure<ApiDirectScrapeResult>>;
