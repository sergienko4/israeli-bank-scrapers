/**
 * Allow-lists for carried step URLs. Each producer's extract, final URL or
 * handoff capture contributes rules; the consumer checks its actual URL
 * against those rules immediately before it is sent.
 */

import type { IUrlRule } from '../../../Types/Domain/FetchPolicy.js';
import type { IStepConfig } from '../ConfigContracts/index.js';

/**
 * Read the URL rules a step declares for one carry slot.
 * @param step - Potential URL producer.
 * @param slot - Carried URL slot.
 * @returns The extract, final-URL and handoff rules for that slot.
 */
function allowedRulesOf(step: IStepConfig, slot: string): readonly IUrlRule[] {
  const extract = step.extractRules?.[slot]?.url ?? [];
  const final =
    step.finalUrlInto === slot && typeof step.redirect === 'object' ? step.redirect.allow : [];
  const handoff = step.locationCapture?.into === slot ? step.locationCapture.url : [];
  return [...extract, ...final, ...handoff];
}

/**
 * Collect the URL allow-lists declared before a carried GET in its own list.
 * @param steps - Login or resume steps in execution order.
 * @param index - Index of the carried GET.
 * @returns Rules from earlier producers, or an empty list without a source.
 */
function carriedUrlRulesOf(steps: readonly IStepConfig[], index: number): readonly IUrlRule[] {
  const slot = steps[index].urlFromCarry;
  if (slot === undefined) return [];
  return steps.slice(0, index).flatMap((step): readonly IUrlRule[] => allowedRulesOf(step, slot));
}

export { allowedRulesOf, carriedUrlRulesOf };
