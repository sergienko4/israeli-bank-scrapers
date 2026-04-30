/**
 * Pepper scrape entry point — thin factory over the generic driver.
 * All logic lives in _Shared/GenericHeadlessScrape.ts; this file only
 * binds the shape declaration to the exported function name.
 */

import type { IActionContext, IPipelineContext } from '../../../Types/PipelineContext.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { buildGenericHeadlessScrape } from '../../_Shared/GenericHeadlessScrape.js';
import { PEPPER_SHAPE } from './PepperShape.js';

const SCRAPE_FN = buildGenericHeadlessScrape(PEPPER_SHAPE);

/**
 * Pepper scrape — delegates to the generic driver bound with PEPPER_SHAPE.
 * @param ctx - Action context.
 * @returns Updated pipeline context with scrape accounts.
 */
async function pepperApiScrape(ctx: IActionContext): Promise<Procedure<IPipelineContext>> {
  return SCRAPE_FN(ctx);
}

export default pepperApiScrape;
export { pepperApiScrape };
