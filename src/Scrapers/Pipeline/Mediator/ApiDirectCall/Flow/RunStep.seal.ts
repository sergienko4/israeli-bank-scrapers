/**
 * Step seal (N10) — seal a credential into the prepared body at the step's
 * `writeTo` pointer, before the body signature and the request. The source is
 * read from creds and the hex modulus from carry; the sealed text is written
 * only into the body, never into carry. Failures name the step, never a value.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { ISealFieldConfig, RefToken } from '../ConfigContracts/index.js';
import { SEALERS } from '../Crypto/SealKinds.js';
import { type JsonValue, walkPointer } from '../Envelope/JsonPointer.js';
import { type ITemplateScope, resolveRef } from '../Template/RefResolver.js';
import type { IPreparedBody, IStepConfig } from './RunStep.types.js';
import { writeAtPointer } from './RunStepBodySigning.pointer.js';

type SealBody = IPreparedBody['body'];

/**
 * The text a ref resolves to, when it resolves to text.
 * @param token - Ref token.
 * @param scope - Step scope.
 * @returns The text, or false when the ref is missing or not a string.
 */
function refText(token: RefToken, scope: ITemplateScope): string | false {
  const resolved = resolveRef(token, scope);
  if (!isOk(resolved) || typeof resolved.value !== 'string') return false;
  return resolved.value;
}

/**
 * Seal the configured source under the configured modulus.
 * @param seal - Step seal config.
 * @param scope - Step scope.
 * @returns The sealed value, or a failure that names no value.
 */
function sealedValue(seal: ISealFieldConfig, scope: ITemplateScope): Procedure<string> {
  const modulusHex = refText(seal.modulusRef, scope);
  if (modulusHex === false) return fail(ScraperErrorTypes.Generic, 'seal key invalid');
  const source = refText(seal.sourceRef, scope);
  if (source === false) return fail(ScraperErrorTypes.Generic, 'seal source invalid');
  const sealer = SEALERS[seal.kind];
  return sealer({ source, modulusHex, params: seal.params });
}

/**
 * Write a seal only into an existing field of the prepared body.
 * @param body - Cloned body.
 * @param pointer - Seal destination.
 * @param value - Sealed value.
 * @returns Updated body or invalid-destination failure.
 */
function writeExistingSeal(body: SealBody, pointer: string, value: string): Procedure<SealBody> {
  const resolved = walkPointer(body as JsonValue, pointer);
  const invalid = fail(ScraperErrorTypes.Generic, 'seal writeTo invalid');
  if (!isOk(resolved)) return invalid;
  const written = writeAtPointer(body, pointer, value);
  return isOk(written) ? written : invalid;
}

/**
 * Write the step's sealed field into the prepared body, when it names one.
 * @param step - Step config.
 * @param prepared - Hydrated body and scope.
 * @returns The body with the sealed field, or `<step> seal …` failure.
 */
function applySeal(step: IStepConfig, prepared: IPreparedBody): Procedure<IPreparedBody> {
  const seal = step.seal;
  if (seal === undefined) return succeed(prepared);
  const sealed = sealedValue(seal, prepared.scope);
  if (!isOk(sealed)) return fail(ScraperErrorTypes.Generic, `${step.name} ${sealed.errorMessage}`);
  const body = structuredClone(prepared.body);
  const written = writeExistingSeal(body, seal.writeTo, sealed.value);
  if (!isOk(written)) return fail(ScraperErrorTypes.Generic, `${step.name} seal writeTo invalid`);
  return succeed({ body: written.value, scope: prepared.scope });
}

export default applySeal;
export { applySeal };
