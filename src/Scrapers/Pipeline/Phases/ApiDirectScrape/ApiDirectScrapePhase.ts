/**
 * ApiDirectScrape phase — post-login data fetch via the configured
 * IApiDirectScrapeShape. The phase is a thin orchestration wrapper:
 * the real work (customer → per-account balance + paginated txns,
 * row mapping, context merge) lives in ApiDirectScrapeActions so
 * the per-file LOC ceiling is respected.
 *
 * Zero bank-name coupling per Rule #11. The bank's SHAPE config
 * is supplied by the PipelineBuilder via withApiDirect(CALL, SHAPE)
 * which wires this phase into the chain in place of the legacy
 * SCRAPE phase + custom action exec. The phase name
 * `api-direct-scrape` is registered in NO_RETRY_PHASES so the
 * sanitization pulse will not re-invoke real API calls on failure.
 */

import { BasePhase } from '../../Types/BasePhase.js';
import type { IActionContext, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { buildGenericHeadlessScrape } from './ApiDirectScrapeActions.js';
import type { IApiDirectScrapeShape } from './IApiDirectScrapeShape.js';

/** Bound phase action — the shape-driven scrape function. */
export type ApiDirectScrapeFn = (ctx: IActionContext) => Promise<Procedure<IPipelineContext>>;

/** ApiDirectScrape phase — BasePhase bound to a shape literal. */
class ApiDirectScrapePhase extends BasePhase {
  public readonly name = 'api-direct-scrape' as const;
  private readonly _scrapeFn: ApiDirectScrapeFn;

  /**
   * Create the phase bound to a bank's shape literal.
   * @param scrapeFn - Bound scrape function from buildGenericHeadlessScrape.
   */
  constructor(scrapeFn: ApiDirectScrapeFn) {
    super();
    this._scrapeFn = scrapeFn;
  }

  /** @inheritdoc */
  public async action(
    _ctx: IActionContext,
    input: IActionContext,
  ): Promise<Procedure<IActionContext>> {
    const result = await this._scrapeFn(input);
    return result as unknown as Procedure<IActionContext>;
  }
}

/**
 * Bind a SHAPE to the ApiDirectScrape phase, returning the bound
 * function the legacy pipeline executor invokes per scrape run.
 *
 * @param shape - Bank-supplied shape declaration (data only).
 * @returns Phase function that performs the scrape against the
 *   supplied shape and emits the structured trace events.
 */
function createApiDirectScrapePhase<TAcct, TCursor>(
  shape: IApiDirectScrapeShape<TAcct, TCursor>,
): ApiDirectScrapeFn {
  return buildGenericHeadlessScrape(shape);
}

/**
 * Build an ApiDirectScrape BasePhase bound to a shape literal.
 * Used by PipelineBuilder.withApiDirect(call, shape) to wire the phase
 * into the chain. The resulting phase carries name
 * `api-direct-scrape` so NO_RETRY_PHASES suppresses sanitization
 * pulse retries.
 *
 * @param shape - Bank-supplied shape declaration (data only).
 * @returns BasePhase instance with name 'api-direct-scrape'.
 */
function buildApiDirectScrapePhase<TAcct, TCursor>(
  shape: IApiDirectScrapeShape<TAcct, TCursor>,
): ApiDirectScrapePhase {
  const fn = buildGenericHeadlessScrape(shape);
  return Reflect.construct(ApiDirectScrapePhase, [fn]);
}

export default createApiDirectScrapePhase;
export { ApiDirectScrapePhase, buildApiDirectScrapePhase, createApiDirectScrapePhase };
