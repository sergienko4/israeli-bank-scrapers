/**
 * Envelope codec rules for an api-direct call config. A step naming
 * `codec` must send a `json` body and read a `json` answer, since the codec
 * seals and opens JSON. An `exchange` codec writes the session key and id to
 * two distinct, non-blank slots. No codec slot — the client scalar, the
 * session key or the session id — is a `sessionCarry` slot: the scrape gets
 * server-issued values only.
 */

import type {
  EnvelopeCodec,
  IStepConfig,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import {
  allSteps,
  anyStep,
  type IApiDirectRule,
  type IApiDirectRuleInput,
} from './ApiDirectRuleInput.js';

/** Prefix of a codec's carry refs. */
const CARRY_PREFIX = 'carry.';

/**
 * Whether a codec step sends or reads anything but JSON.
 * @param step - Login step.
 * @returns True for a codec on a non-`json` body or answer.
 */
function isCodecOffJson(step: IStepConfig): boolean {
  if (step.codec === undefined) return false;
  const encoding = step.encoding ?? 'json';
  const response = step.response ?? 'json';
  return encoding !== 'json' || response !== 'json';
}

/**
 * The codecs of every login and resume step.
 * @param input - Rule input.
 * @returns The codecs, in step order.
 */
function codecsOf(input: IApiDirectRuleInput): readonly EnvelopeCodec[] {
  return allSteps(input.call).flatMap(step => (step.codec === undefined ? [] : [step.codec]));
}

/**
 * Whether an `exchange` codec has a blank slot or one slot for key and id.
 * @param codec - Codec config.
 * @returns True when the key and id would not land in two slots.
 */
function isExchangeSlotless(codec: EnvelopeCodec): boolean {
  if (codec.mode !== 'exchange') return false;
  const slots = [codec.keyInto, codec.sessionInto];
  const isBlank = slots.some(slot => slot.trim() === '');
  return isBlank || codec.keyInto === codec.sessionInto;
}

/**
 * The carry slots a codec reads or writes.
 * @param codec - Codec config.
 * @returns Its key, session and client-scalar slots.
 */
function slotsOf(codec: EnvelopeCodec): readonly string[] {
  if (codec.mode === 'sealed') {
    return [codec.keyRef, codec.sessionRef].map(ref => ref.slice(CARRY_PREFIX.length));
  }
  const privateSlot = codec.privateRef.slice(CARRY_PREFIX.length);
  return [privateSlot, codec.keyInto, codec.sessionInto];
}

/**
 * Whether any step's `exchange` codec lacks two distinct slots.
 * @param input - Rule input.
 * @returns True for a blank or shared slot.
 */
function hasSlotlessExchange(input: IApiDirectRuleInput): boolean {
  return codecsOf(input).some(isExchangeSlotless);
}

/**
 * Whether `sessionCarry` keeps a codec slot.
 * @param input - Rule input.
 * @returns True when some codec slot is a session slot.
 */
function hasSessionCodecSlot(input: IApiDirectRuleInput): boolean {
  const kept = input.call.sessionCarry ?? [];
  const slots = codecsOf(input).flatMap(slotsOf);
  return slots.some(slot => kept.includes(slot));
}

/** Envelope codec rules, checked after the carry-generator rules. */
const API_DIRECT_CODEC_RULES: readonly IApiDirectRule[] = [
  {
    message: 'steps.codec: needs a json body and a json response',
    isBroken: anyStep(isCodecOffJson),
  },
  {
    message: 'steps.codec: exchange needs distinct keyInto and sessionInto',
    isBroken: hasSlotlessExchange,
  },
  {
    message: 'steps.codec: codec slots must not be sessionCarry slots',
    isBroken: hasSessionCodecSlot,
  },
];

export default API_DIRECT_CODEC_RULES;
export { API_DIRECT_CODEC_RULES };
