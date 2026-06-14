/**
 * LOGIN PRE orchestrator — readiness probe, preAction callback,
 * neterror probe, field-discovery commit.
 *
 * <p>Phase 12d split: thin façade composing
 * PreOrchestrator/{PreOrchestratorTypes,PreOrchestratorReadiness,
 * PreOrchestratorDiscovery}.ts.
 */

import type { Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail } from '../../Types/Procedure.js';
import { runPostPreamble } from './PreOrchestrator/PreOrchestratorDiscovery.js';
import {
  probeNeterrorAndFail,
  runDiscoverFormPreamble,
} from './PreOrchestrator/PreOrchestratorReadiness.js';
import {
  type IDiscoverFormResources,
  LOGIN_PRE_NO_BROWSER,
  LOGIN_PRE_NO_MEDIATOR,
} from './PreOrchestrator/PreOrchestratorTypes.js';

/**
 * Run the post-gate LOGIN.PRE flow.
 * @param r - Discover-form resources.
 * @returns Updated context with login state and field discovery.
 */
async function runDiscoverFormFlow(
  r: IDiscoverFormResources,
): Promise<Procedure<IPipelineContext>> {
  const neterror = await probeNeterrorAndFail(r.page);
  if (neterror !== false) return neterror;
  const preamble = await runDiscoverFormPreamble(r.config, r.page);
  if (preamble.tag === 'fail') return preamble.proc;
  return runPostPreamble(r, preamble.activeFrame);
}

/**
 * PRE: Discover credential form.
 * @param config - Login config.
 * @param input - Pipeline context with browser.
 * @returns Updated context with login state and field discovery.
 */
async function executeDiscoverForm(
  config: ILoginConfig,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, LOGIN_PRE_NO_BROWSER);
  if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, LOGIN_PRE_NO_MEDIATOR);
  const page: Page = input.browser.value.page;
  const mediator = input.mediator.value;
  return runDiscoverFormFlow({ config, input, page, mediator });
}

export default executeDiscoverForm;
export { executeDiscoverForm };
