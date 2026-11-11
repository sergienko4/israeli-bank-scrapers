/**
 * Allow-lists for carried step URLs. Each checked producer contributes rules;
 * the consumer checks its actual URL immediately before it is sent.
 */

import type { IUrlRule } from '../../../../Types/Domain/FetchPolicy.js';
import type { IStepConfig } from '../../ConfigContracts/index.js';

/**
 * Reads a structured SDK capture's rules for a carried URL.
 * @param step - Potential URL producer.
 * @param slot - Carried URL slot.
 * @returns SDK rules for that slot, or none.
 */
function structuredRulesOf(step: IStepConfig, slot: string): readonly IUrlRule[] {
  const capture = step.structuredCapture;
  return capture?.kind === 'sdk-reference' && capture.into === slot ? capture.url : [];
}

/**
 * Reads checked derivation destinations for a carried URL.
 * @param step - Potential URL producer.
 * @param slot - Carried URL slot.
 * @returns Destination rules for that slot.
 */
function mappedRulesOf(step: IStepConfig, slot: string): readonly IUrlRule[] {
  const derived = step.deriveCarry ?? [];
  return derived.flatMap((entry): readonly IUrlRule[] => {
    const op = entry.op;
    if (entry.into !== slot || (op?.kind !== 'url-path-map' && op?.kind !== 'url-compose'))
      return [];
    const rules = op.url;
    return Array.isArray(rules) ? op.url : [];
  });
}

/**
 * Read the URL rules a step declares for one carry slot.
 * @param step - Potential URL producer.
 * @param slot - Carried URL slot.
 * @returns All declared URL rules for that slot.
 */
function allowedRulesOf(step: IStepConfig, slot: string): readonly IUrlRule[] {
  const extract = step.extractRules?.[slot]?.url ?? [];
  const final =
    step.finalUrlInto === slot && typeof step.redirect === 'object' ? step.redirect.allow : [];
  const handoff = step.locationCapture?.into === slot ? step.locationCapture.url : [];
  const structured = structuredRulesOf(step, slot);
  const mapped = mappedRulesOf(step, slot);
  return [...extract, ...final, ...handoff, ...structured, ...mapped];
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
