/**
 * Seal rules for an api-direct call config (N10). A sealed field must name a
 * known kind, sit on a POST step whose body shape is a record, be written at
 * a JSON pointer below the root, and carry constants the seal can use: an odd
 * public exponent of at least 3, a 1–64 character seed drawn from a
 * printable-ASCII alphabet, 1–53 characters per RSA block (the PKCS#1 v1.5
 * room of the smallest accepted 512-bit key) and printable-ASCII framing.
 */

import type {
  ISealFieldConfig,
  ISealRsaBlockXorParams,
  IStepConfig,
  JsonValueTemplate,
  SealKind,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { allSteps, type IApiDirectRule, type IApiDirectRuleInput } from './ApiDirectRuleInput.js';

/** One check of a step's seal. */
type SealCheck = (seal: ISealFieldConfig, step: IStepConfig) => boolean;

/** Every seal kind; the record type keeps it in step with `SealKind`. */
const KNOWN_SEAL_KINDS: Readonly<Record<SealKind, true>> = { 'rsa-pkcs1-block-xor': true };

const PRINTABLE_ASCII = /^[\u0020-\u007E]*$/;
const MAX_SEED_CHARS = 64;
const MAX_BLOCK_CHARS = 53;

/**
 * Whether a value is an integer within bounds.
 * @param value - Candidate.
 * @param min - Lowest allowed.
 * @param max - Highest allowed.
 * @returns True when in range.
 */
function isIntIn(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

/**
 * Whether a value is printable-ASCII text.
 * @param text - Candidate.
 * @returns True for printable ASCII.
 */
function isAscii(text: string): boolean {
  return typeof text === 'string' && PRINTABLE_ASCII.test(text);
}

/**
 * Whether the seal names a kind no sealer serves.
 * @param seal - Seal config.
 * @returns True for an unknown kind.
 */
function isUnknownKind(seal: ISealFieldConfig): boolean {
  return !Object.hasOwn(KNOWN_SEAL_KINDS, seal.kind);
}

/**
 * Whether a body shape is a plain record, not an array or a single ref/literal.
 * @param shape - Body shape.
 * @returns True for a record shape.
 */
function isRecordShape(shape: JsonValueTemplate): boolean {
  if (typeof shape !== 'object' || Array.isArray(shape)) return false;
  return !Object.hasOwn(shape, '$ref') && !Object.hasOwn(shape, '$literal');
}

/**
 * Whether the seal sits where no record body can take it.
 * @param _seal - Seal config.
 * @param step - The step naming it.
 * @returns True for a GET step or a non-record body.
 */
function isHostless(_seal: ISealFieldConfig, step: IStepConfig): boolean {
  if (step.method === 'GET') return true;
  return !isRecordShape(step.body.shape);
}

/**
 * Whether `writeTo` is not a pointer below the body root.
 * @param seal - Seal config.
 * @returns True for a bad pointer.
 */
function isBadPointer(seal: ISealFieldConfig): boolean {
  return !seal.writeTo.startsWith('/') || seal.writeTo.length < 2;
}

/**
 * Whether the seed constants can draw a seed.
 * @param params - Seal constants.
 * @returns True for a 1–64 length and a non-empty ASCII alphabet.
 */
function isSeedSound(params: ISealRsaBlockXorParams): boolean {
  if (!isIntIn(params.seedLength, 1, MAX_SEED_CHARS)) return false;
  return isAscii(params.seedAlphabet) && params.seedAlphabet.length > 0;
}

/**
 * Whether the envelope framing is ASCII with a non-empty separator and terminator.
 * @param params - Seal constants.
 * @returns True for sound framing.
 */
function isFramingSound(params: ISealRsaBlockXorParams): boolean {
  const framing = [params.prefix, params.blockSeparator, params.envelopeTerminator];
  if (!framing.every(isAscii)) return false;
  return params.blockSeparator.length > 0 && params.envelopeTerminator.length > 0;
}

/**
 * Whether any seal constant is out of range.
 * @param seal - Seal config.
 * @returns True when the seal cannot run with its constants.
 */
function hasBadParams(seal: ISealFieldConfig): boolean {
  const { params } = seal;
  const exponent = params.exponent;
  const isExponentSound = Number.isSafeInteger(exponent) && exponent >= 3 && exponent % 2 === 1;
  if (!isExponentSound || !isSeedSound(params)) return true;
  return !isIntIn(params.blockChars, 1, MAX_BLOCK_CHARS) || !isFramingSound(params);
}

/**
 * Whether any login or resume step's seal fails the check.
 * @param input - Rule input.
 * @param check - Seal check.
 * @returns True when a seal is broken.
 */
function anySealBroken(input: IApiDirectRuleInput, check: SealCheck): boolean {
  const steps = allSteps(input.call);
  return steps.some((step): boolean => step.seal !== undefined && check(step.seal, step));
}

/**
 * Build a rule that fails when any step's seal fails the check.
 * @param message - Failure text.
 * @param check - Seal check.
 * @returns The rule.
 */
function sealRule(message: string, check: SealCheck): IApiDirectRule {
  return {
    message,
    /**
     * Whether the rule is broken.
     * @param input - Rule input.
     * @returns True when a seal fails the check.
     */
    isBroken: (input: IApiDirectRuleInput): boolean => anySealBroken(input, check),
  };
}

/** Seal rules, checked after the form-body rules. */
const API_DIRECT_SEAL_RULES: readonly IApiDirectRule[] = [
  sealRule('steps.seal.kind: unknown seal kind', isUnknownKind),
  sealRule('steps.seal: needs a POST step with a record body', isHostless),
  sealRule('steps.seal.writeTo: must be a JSON pointer', isBadPointer),
  sealRule('steps.seal.params: out of range', hasBadParams),
];

export default API_DIRECT_SEAL_RULES;
export { API_DIRECT_SEAL_RULES };
