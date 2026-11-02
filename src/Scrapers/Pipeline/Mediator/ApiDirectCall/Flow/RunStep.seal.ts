/**
 * Step seal (N10, N44) — seal credentials into the prepared body at the
 * pointers the step's seal plans, before the body signature and the request.
 * Sources are read from creds and the key from carry; sealed text is written
 * only into the body, never into carry. Failures name the step, never a value.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import { planSeal } from '../Crypto/SealKinds.js';
import type { ISealedWrite, SealRef, SealRefText } from '../Crypto/SealPlan.js';
import { type JsonValue, walkPointer } from '../Envelope/JsonPointer.js';
import { type ITemplateScope, resolveRefText } from '../Template/RefResolver.js';
import type { IPreparedBody, IStepConfig } from './RunStep.types.js';
import { writeAtPointer } from './RunStepBodySigning.pointer.js';

/** The prepared body as the pointer writer takes it. */
type Body = IPreparedBody['body'];

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
  const invalid = fail(ScraperErrorTypes.Generic, 'seal writeTo invalid');
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
  const unsealed: Procedure<Body> = succeed(structuredClone(prepared.body));
  const written = plan.value.reduce(writeSealed, unsealed);
  if (!isOk(written)) return fail(ScraperErrorTypes.Generic, `${step.name} seal writeTo invalid`);
  return succeed({ body: written.value, scope: prepared.scope });
}

export default applySeal;
export { applySeal };
