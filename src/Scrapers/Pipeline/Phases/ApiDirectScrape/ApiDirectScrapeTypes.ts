/**
 * ApiDirectScrape shared types — extracted so ApiDirectScrapeActions and
 * ApiDirectScrapePhase both depend on this leaf module instead of each
 * other, breaking the Actions<->Phase import cycle.
 */

import type { Option } from '../../Types/Option.js';
import type { IActionContext, IScrapeState } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';

/**
 * Action-context payload returned by the shape-driven scrape function:
 * the sealed action context augmented with the `scrape` slot that
 * DASHBOARD-style phases would otherwise commit. The intersection is
 * a true subtype of {@link IActionContext}, so this Procedure is
 * directly assignable to `Procedure<IActionContext>` (the shape
 * required by {@link BasePhase.action}) without an unsafe cast.
 */
export type ApiDirectScrapeResult = IActionContext & {
  readonly scrape: Option<IScrapeState>;
};

/** Bound phase action — the shape-driven scrape function. */
export type ApiDirectScrapeFn = (ctx: IActionContext) => Promise<Procedure<ApiDirectScrapeResult>>;
