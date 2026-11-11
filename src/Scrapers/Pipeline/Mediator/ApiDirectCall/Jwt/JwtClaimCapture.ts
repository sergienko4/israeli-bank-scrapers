/**
 * Binds issued JWT claims to the current flow before later requests.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { IJsonObject } from '../../../Types/JsonValue.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { IJwtClaimsCapture, IJwtClaimSlot, RefToken } from '../ConfigContracts/index.js';
import { walkPointer } from '../Envelope/JsonPointer.js';
import { isSafeText } from '../Flow/Steps/RunStep.classify.checks.js';
import type { ITemplateScope } from '../Template/RefResolver.js';
import { resolveRefText } from '../Template/RefResolver.js';
import { issuedJwtPayload } from './IssuedJwtPayload.js';

/** Successful captures contain only the declared text slots. */
type ClaimSlots = Readonly<Record<string, string>>;
type CaptureResult = Procedure<ClaimSlots>;

const INVALID_CLAIMS = 'jwt claims invalid';

/** Inputs shared by every claim binding. */
interface IBindingInput {
  readonly payload: IJsonObject;
  readonly scope: ITemplateScope;
  readonly maxChars: number;
}

/**
 * Whether a claim equals the configured reference.
 * @param input - Claims, scope and token bound.
 * @param entry - Claim pointer and expected reference.
 * @returns True for an exact, bounded text match.
 */
function isBound(input: IBindingInput, entry: [string, RefToken]): boolean {
  const [pointer, ref] = entry;
  const claim = walkPointer(input.payload, pointer);
  const expected = resolveRefText(ref, input.scope);
  if (!isOk(claim) || !isSafeText(claim.value, input.maxChars)) return false;
  return expected !== false && claim.value === expected;
}

/**
 * Reads one configured text claim.
 * @param payload - Decoded claims.
 * @param entry - Output slot and capture policy.
 * @returns A slot pair, or false for a missing or invalid claim.
 */
function claimSlot(payload: IJsonObject, entry: [string, IJwtClaimSlot]): [string, string] | false {
  const [slot, config] = entry;
  const claim = walkPointer(payload, config.pointer);
  if (!isOk(claim) || !isSafeText(claim.value, config.maxChars)) return false;
  const policy: unknown = Reflect.get(config, 'rejectBlank');
  if (policy !== undefined && policy !== true) return false;
  if (policy === true && claim.value.trim() === '') return false;
  return [slot, claim.value];
}

/**
 * Reads all configured claim slots.
 * @param payload - Decoded claims.
 * @param capture - Capture policy.
 * @returns Captured slots, or a value-free refusal.
 */
function readClaimSlots(payload: IJsonObject, capture: IJwtClaimsCapture): Procedure<ClaimSlots> {
  const entries = Object.entries(capture.captures);
  const slots = entries.map(entry => claimSlot(payload, entry));
  if (slots.includes(false)) return fail(ScraperErrorTypes.Generic, INVALID_CLAIMS);
  const present = slots.filter((slot): slot is [string, string] => slot !== false);
  const captured = Object.fromEntries(present);
  return succeed(captured);
}

/**
 * Whether a JWT has an integer expiry in the future.
 * @param expiry - Untrusted expiry claim.
 * @returns True for an unexpired safe integer.
 */
function isFutureExpiry(expiry: unknown): boolean {
  if (typeof expiry !== 'number' || !Number.isSafeInteger(expiry)) return false;
  return expiry > Math.floor(Date.now() / 1000);
}

/**
 * Reads a bounded token with an unexpired payload.
 * @param capture - Token source and limit.
 * @param scope - Flow scope.
 * @returns Claims, or false for an unusable token.
 */
function freshClaims(capture: IJwtClaimsCapture, scope: ITemplateScope): IJsonObject | false {
  const token = scope.carry[capture.from];
  if (typeof token !== 'string') return false;
  const payload = issuedJwtPayload(token, capture.maxTokenChars);
  return payload !== false && isFutureExpiry(payload.exp) ? payload : false;
}

/**
 * Checks the claims and captures only configured values.
 * @param capture - Binding policy.
 * @param scope - Flow scope including newly issued carry.
 * @returns Checked claim slots or a value-free refusal.
 */
function captureJwtClaims(capture: IJwtClaimsCapture, scope: ITemplateScope): CaptureResult {
  const payload = freshClaims(capture, scope);
  if (payload === false) return fail(ScraperErrorTypes.Generic, INVALID_CLAIMS);
  const entries = Object.entries(capture.equals);
  const binding = { payload, scope, maxChars: capture.maxTokenChars };
  if (!entries.every(entry => isBound(binding, entry)))
    return fail(ScraperErrorTypes.Generic, INVALID_CLAIMS);
  return readClaimSlots(payload, capture);
}

export default captureJwtClaims;
export { captureJwtClaims };
