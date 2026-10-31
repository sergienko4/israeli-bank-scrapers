/**
 * Carry-generator rules for an api-direct call config (N25), on login and
 * resume steps alike. An `rsa-key` generator must name at least one slot to
 * write, or the key it makes is lost; a `pkcs10-csr` generator needs a
 * subject and a slot for the request.
 */

import type { ICarryGenerator } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { allSteps, type IApiDirectRule, type IApiDirectRuleInput } from './ApiDirectRuleInput.js';

/** Flags one generator config. */
type GeneratorCheck = (generator: ICarryGenerator) => boolean;

/**
 * Whether an `rsa-key` generator names no slot.
 * @param generator - Generator config.
 * @returns True when neither `keyInto` nor `spkiSha256HexInto` is set.
 */
function isTargetless(generator: ICarryGenerator): boolean {
  if (generator.kind !== 'rsa-key') return false;
  return generator.keyInto === undefined && generator.spkiSha256HexInto === undefined;
}

/**
 * Whether a `pkcs10-csr` generator has no subject or a blank slot.
 * @param generator - Generator config.
 * @returns True for an empty subject or a blank `into`.
 */
function isCsrIncomplete(generator: ICarryGenerator): boolean {
  if (generator.kind !== 'pkcs10-csr') return false;
  return generator.subject.length === 0 || generator.into.trim() === '';
}

/**
 * Whether any login or resume step runs a generator the check flags.
 * @param input - Rule input.
 * @param check - Generator check.
 * @returns True when some generator is flagged.
 */
function anyGenerator(input: IApiDirectRuleInput, check: GeneratorCheck): boolean {
  const generators = allSteps(input.call).flatMap(step => step.generate ?? []);
  return generators.some(check);
}

/**
 * Whether any step runs a targetless `rsa-key` generator.
 * @param input - Rule input.
 * @returns True when a key would be lost.
 */
function hasTargetlessGenerator(input: IApiDirectRuleInput): boolean {
  return anyGenerator(input, isTargetless);
}

/**
 * Whether any step runs an incomplete `pkcs10-csr` generator.
 * @param input - Rule input.
 * @returns True for a CSR with no subject or slot.
 */
function hasIncompleteCsr(input: IApiDirectRuleInput): boolean {
  return anyGenerator(input, isCsrIncomplete);
}

/** Carry-generator rules, checked after the step-guard rules. */
const API_DIRECT_GENERATE_RULES: readonly IApiDirectRule[] = [
  {
    message: 'steps.generate: rsa-key needs keyInto or spkiSha256HexInto',
    isBroken: hasTargetlessGenerator,
  },
  {
    message: 'steps.generate: pkcs10-csr needs a subject and into',
    isBroken: hasIncompleteCsr,
  },
];

export default API_DIRECT_GENERATE_RULES;
export { API_DIRECT_GENERATE_RULES };
