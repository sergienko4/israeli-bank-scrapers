/**
 * Carry-generator rules for an api-direct call config (N25), on login and
 * resume steps alike. An `rsa-key` generator must name at least one slot to
 * write, or the key it makes is lost; a `pkcs10-csr` generator needs a
 * subject and a slot for the request. An `ecdh-key` generator (N38) needs two
 * distinct slots, and its private scalar never reaches `sessionCarry`: the
 * scrape gets server-issued values only. A `random-hex` seed (N42) draws an
 * integer count of bytes from 1 to 64. The envelope codec rules (N39) of
 * `ApiDirectCodecRules.ts` run next, then the step URL rules (N40/N41) of
 * `ApiDirectUrlRules.ts`.
 */

import type {
  ICarryGenerator,
  ISeedCarrySource,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { API_DIRECT_CODEC_RULES } from './ApiDirectCodecRules.js';
import { allSteps, type IApiDirectRule, type IApiDirectRuleInput } from './ApiDirectRuleInput.js';
import { API_DIRECT_URL_RULES } from './ApiDirectUrlRules.js';

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
 * Whether an `ecdh-key` generator has a blank slot or one slot for both keys.
 * @param generator - Generator config.
 * @returns True when the two keys would not land in two slots.
 */
function isEcdhSlotless(generator: ICarryGenerator): boolean {
  if (generator.kind !== 'ecdh-key') return false;
  const slots = [generator.publicInto, generator.privateInto];
  const isBlank = slots.some(slot => slot.trim() === '');
  return isBlank || generator.publicInto === generator.privateInto;
}

/**
 * The private-key slot of an `ecdh-key` generator.
 * @param generator - Generator config.
 * @returns `[privateInto]` for an ECDH generator, else no slot.
 */
function privateSlotsOf(generator: ICarryGenerator): readonly string[] {
  if (generator.kind !== 'ecdh-key') return [];
  return [generator.privateInto];
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

/**
 * Whether any step runs an `ecdh-key` generator without two distinct slots.
 * @param input - Rule input.
 * @returns True for a blank or shared ECDH slot.
 */
function hasSlotlessEcdh(input: IApiDirectRuleInput): boolean {
  return anyGenerator(input, isEcdhSlotless);
}

/**
 * Whether `sessionCarry` keeps an ECDH private scalar.
 * @param input - Rule input.
 * @returns True when some `privateInto` is a session slot.
 */
function hasSessionPrivateKey(input: IApiDirectRuleInput): boolean {
  const kept = input.call.sessionCarry ?? [];
  const generators = allSteps(input.call).flatMap(step => step.generate ?? []);
  const privateSlots = generators.flatMap(privateSlotsOf);
  return privateSlots.some(slot => kept.includes(slot));
}

/** Most bytes a `random-hex` seed may draw. */
const MAX_RANDOM_HEX_BYTES = 64;

/**
 * Whether a seed entry is a `random-hex` bootstrap of a bad length.
 * @param entry - One `seedCarryFromCreds` entry.
 * @returns True unless the byte count is an integer from 1 to 64.
 */
function isBadRandomHex(entry: string | ISeedCarrySource): boolean {
  if (typeof entry === 'string' || entry.bootstrap?.kind !== 'random-hex') return false;
  const bytes = entry.bootstrap.bytes;
  const isCount = Number.isInteger(bytes) && bytes >= 1;
  return !isCount || bytes > MAX_RANDOM_HEX_BYTES;
}

/**
 * Whether any seed draws a `random-hex` value of a bad length.
 * @param input - Rule input.
 * @returns True for a byte count off 1..64.
 */
function hasBadRandomHex(input: IApiDirectRuleInput): boolean {
  const seeds = input.call.seedCarryFromCreds ?? [];
  return seeds.some(isBadRandomHex);
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
  {
    message: 'steps.generate: ecdh-key needs distinct publicInto and privateInto',
    isBroken: hasSlotlessEcdh,
  },
  {
    message: 'steps.generate: ecdh-key privateInto must not be a sessionCarry slot',
    isBroken: hasSessionPrivateKey,
  },
  {
    message: 'seedCarryFromCreds: random-hex needs integer bytes from 1 to 64',
    isBroken: hasBadRandomHex,
  },
  ...API_DIRECT_CODEC_RULES,
  ...API_DIRECT_URL_RULES,
];

export default API_DIRECT_GENERATE_RULES;
export { API_DIRECT_GENERATE_RULES };
