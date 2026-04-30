/**
 * OneZero scrape entry point — thin factory over the generic driver.
 * All logic lives in _Shared/GenericHeadlessScrape.ts; this file only
 * binds the shape declaration to the exported function name.
 */

import type { IActionContext, IPipelineContext } from '../../../Types/PipelineContext.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { buildGenericHeadlessScrape } from '../../_Shared/GenericHeadlessScrape.js';
import { ONE_ZERO_SHAPE } from './OneZeroShape.js';

const SCRAPE_FN = buildGenericHeadlessScrape(ONE_ZERO_SHAPE);

/**
 * OneZero scrape — delegates to the generic driver bound with ONE_ZERO_SHAPE.
 * @param ctx - Action context.
 * @returns Updated pipeline context with scrape accounts.
 */
async function oneZeroApiScrape(ctx: IActionContext): Promise<Procedure<IPipelineContext>> {
  return SCRAPE_FN(ctx);
}

export default oneZeroApiScrape;
export { oneZeroApiScrape };
