/**
 * Step seal — seal credentials into the prepared body at the
 * pointers the step's seal plans, before the body signature and the request.
 * Sources are read from creds and the key from carry; sealed text is written
 * only into the body, never into carry. Failures name the step, never a value.
 */

import { ScraperErrorTypes } from '../../../../../Base/ErrorTypes.js';
import type { JsonUnknown, JsonUnknownRecord } from '../../../../Types/JsonValue.js';
import type { Procedure } from '../../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../../Types/Procedure.js';
import { planSeal } from '../../Crypto/SealKinds.js';
import type { ISealedWrite, SealRef, SealRefText } from '../../Crypto/SealPlan.js';
import { type JsonValue, walkPointer } from '../../Envelope/JsonPointer.js';
import { type ITemplateScope, resolveRefText } from '../../Template/RefResolver.js';
import type { IPreparedBody, IStepConfig } from '../RunStep.types.js';
import { isRecordValue } from '../WarmTokenParts.js';
import { writeAtPointer } from './RunStepBodySigning.pointer.js';

/** The prepared body as the pointer writer takes it. */
type Body = IPreparedBody['body'];

const INVALID_SEAL_TARGET = 'seal writeTo invalid';

/**
 * Write one sealed value into the body so far.
 * @param body - Body so far, or its failure.
 * @param write - Sealed value and pointer.
 * @returns The body with the value written.
 */
function writeSealed(body: Procedure<Body>, write: ISealedWrite): Procedure<Body> {
  if (!isOk(body)) return body;
  return writeExistingSeal(body.value, write.writeTo, write.value);
}

/**
 * Write a seal only into an existing field of the prepared body.
 * @param body - Cloned body.
 * @param pointer - Seal destination.
 * @param value - Sealed value.
 * @returns Updated body or invalid-destination failure.
 */
function writeExistingSeal(body: Body, pointer: string, value: string): Procedure<Body> {
  const resolved = walkPointer(body as JsonValue, pointer);
  const invalid = fail(ScraperErrorTypes.Generic, INVALID_SEAL_TARGET);
  if (!isOk(resolved)) return invalid;
  const written = writeAtPointer(body, pointer, value);
  return isOk(written) ? written : invalid;
}

/**
 * The ref reader a seal plans with: the step scope's text of each ref.
 * @param scope - Step scope.
 * @returns The reader.
 */
function sealRefReader(scope: ITemplateScope): SealRefText {
  return (ref: SealRef): string | false => resolveRefText(ref, scope);
}

/**
 * Whether an object is a JSON record rather than a structured-clone leaf.
 * A record's prototype is null or a root prototype, which also recognizes a
 * structured clone made in another realm.
 * @param value - Object being cloned.
 * @returns True for ordinary or null-prototype records.
 */
function isPlainSealRecord(value: object): value is JsonUnknownRecord {
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype === null) return true;
  if (typeof prototype !== 'object') return false;
  return Object.getPrototypeOf(prototype) === null;
}

/**
 * Clone array entries independently.
 * @param values - Array being cloned.
 * @param ancestors - Containers on the current recursion path.
 * @returns Detached array.
 */
function cloneSealList(values: readonly JsonUnknown[], ancestors: WeakSet<object>): JsonUnknown[] {
  return values.map((value): JsonUnknown => cloneSealValue(value, ancestors));
}

/**
 * Clone the entries of a plain JSON record, each occurrence detached.
 * @param value - Plain record being cloned.
 * @param ancestors - Containers on the current recursion path.
 * @returns Detached record.
 */
function cloneSealRecord(value: JsonUnknownRecord, ancestors: WeakSet<object>): JsonUnknown {
  const copied = Object.entries(value).map(([key, child]): [string, JsonUnknown] => {
    const clone = cloneSealValue(child, ancestors);
    return [key, clone];
  });
  return Object.fromEntries(copied);
}

/**
 * Detach one structured-clone container, recursing only into JSON containers.
 * @param value - Container from a structured clone.
 * @param ancestors - Containers on the current recursion path.
 * @returns Detached container or preserved leaf.
 */
function detachClone(value: object, ancestors: WeakSet<object>): JsonUnknown {
  if (Array.isArray(value)) return cloneSealList(value, ancestors);
  if (isPlainSealRecord(value)) return cloneSealRecord(value, ancestors);
  return value;
}

/**
 * Detach the plain containers a structured clone exposes, so shared sibling
 * references become independent occurrences; keep built-in leaves as they are.
 * @param value - Structured clone of a non-plain object or array.
 * @param ancestors - Containers on the current recursion path.
 * @returns Detached clone or preserved leaf.
 */
function cloneDetached(value: object, ancestors: WeakSet<object>): JsonUnknown {
  if (ancestors.has(value)) throw new TypeError(INVALID_SEAL_TARGET);
  ancestors.add(value);
  const clone = detachClone(value, ancestors);
  ancestors.delete(value);
  return clone;
}

/**
 * Clone a JSON container without memoizing sibling references.
 * @param value - Container being cloned.
 * @param ancestors - Containers on the current recursion path.
 * @returns Detached container or structured-clone leaf.
 */
function cloneSealContainer(value: object, ancestors: WeakSet<object>): JsonUnknown {
  if (Array.isArray(value)) return cloneSealList(value, ancestors);
  if (isPlainSealRecord(value)) return cloneSealRecord(value, ancestors);
  const cloned = structuredClone(value);
  return cloneDetached(cloned, ancestors);
}

/**
 * Clone each occurrence of a value, rejecting cycles before any writes.
 * @param value - Value being cloned.
 * @param ancestors - Containers on the current recursion path.
 * @returns Independent clone.
 */
function cloneSealValue(value: JsonUnknown, ancestors: WeakSet<object>): JsonUnknown {
  if (value === null || typeof value !== 'object') return structuredClone(value);
  if (ancestors.has(value)) throw new TypeError(INVALID_SEAL_TARGET);
  ancestors.add(value);
  const clone = cloneSealContainer(value, ancestors);
  ancestors.delete(value);
  return clone;
}

/**
 * Clone a prepared body as independent JSON branches without leaking errors.
 * @param body - Hydrated request body.
 * @returns Detached body or a structured clone failure.
 */
function cloneSealBody(body: Body): Procedure<Body> {
  const invalid = fail(ScraperErrorTypes.Generic, INVALID_SEAL_TARGET);
  try {
    const ancestors = new WeakSet();
    const clone = cloneSealValue(body, ancestors);
    return isRecordValue(clone) ? succeed(clone) : invalid;
  } catch {
    return invalid;
  }
}

/**
 * Apply planned writes to a clone of the hydrated body.
 * @param body - Hydrated request body.
 * @param writes - Sealed values and their destinations.
 * @returns Updated clone or invalid-destination failure.
 */
function applySealPlan(body: Body, writes: readonly ISealedWrite[]): Procedure<Body> {
  const unsealed = cloneSealBody(body);
  return writes.reduce(
    (bodySoFar: Procedure<Body>, sealed: ISealedWrite): Procedure<Body> =>
      writeSealed(bodySoFar, sealed),
    unsealed,
  );
}

/**
 * Write the step's sealed fields into the prepared body, when it names a seal.
 * @param step - Step config.
 * @param prepared - Hydrated body and scope.
 * @returns The body with the sealed fields, or `<step> seal …` failure.
 */
function applySeal(step: IStepConfig, prepared: IPreparedBody): Procedure<IPreparedBody> {
  if (step.seal === undefined) return succeed(prepared);
  const refText = sealRefReader(prepared.scope);
  const plan = planSeal(step.seal, refText);
  if (!isOk(plan)) return fail(ScraperErrorTypes.Generic, `${step.name} ${plan.errorMessage}`);
  const written = applySealPlan(prepared.body, plan.value);
  if (!isOk(written)) return fail(ScraperErrorTypes.Generic, `${step.name} ${INVALID_SEAL_TARGET}`);
  return succeed({ body: written.value, scope: prepared.scope });
}

export default applySeal;
export { applySeal };
