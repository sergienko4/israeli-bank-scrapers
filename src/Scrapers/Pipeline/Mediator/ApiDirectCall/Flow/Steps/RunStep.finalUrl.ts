/**
 * Final-URL carry — a GET step with a manual redirect may name a
 * `finalUrlInto` slot. After its last hop the URL that gave the final answer,
 * kept by the step's capture, is carried there once it passes the step's own
 * `redirect.allow` rules; otherwise the step fails `<step> final url refused`.
 * The hops already passed those rules, so in practice only a request URL that
 * answered without a hop can be refused. The URL is never logged nor named.
 */

import { ScraperErrorTypes } from '../../../../../Base/ErrorTypes.js';
import { matchesAnyUrlRule } from '../../../../Strategy/Fetch/UrlRule.js';
import type { Procedure } from '../../../../Types/Procedure.js';
import { fail, succeed } from '../../../../Types/Procedure.js';
import type { IStepConfig } from '../../ConfigContracts/index.js';
import type { CarryMap, IDispatchBundle } from './RunStep.types.js';

/**
 * Whether a final URL parses and passes the step's manual redirect rules.
 * @param step - Step config.
 * @param url - The URL that gave the final answer, '' when none was kept.
 * @returns True when the step may carry it.
 */
function isAllowedFinal(step: IStepConfig, url: string): boolean {
  const redirect = step.redirect;
  if (typeof redirect !== 'object' || !URL.canParse(url)) return false;
  const target = new URL(url);
  return matchesAnyUrlRule(target, redirect.allow);
}

/**
 * Read a step's final-URL slot after its answer.
 * @param bundle - Dispatch bundle.
 * @returns Procedure with the slot (empty without one), or fail `<step> final url refused`.
 */
function carryFinalUrl(bundle: IDispatchBundle): Procedure<CarryMap> {
  const step = bundle.fireScope.step;
  const slot = step.finalUrlInto;
  if (slot === undefined) return succeed({});
  const url = bundle.fireArgs.headerCapture?.urls[0] ?? '';
  if (!isAllowedFinal(step, url))
    return fail(ScraperErrorTypes.Generic, `${step.name} final url refused`);
  return succeed({ [slot]: url });
}

export default carryFinalUrl;
export { carryFinalUrl };
