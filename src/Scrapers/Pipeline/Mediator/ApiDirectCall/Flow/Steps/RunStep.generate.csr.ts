/**
 * The `pkcs10-csr` carry generator (N25b): it reads the signing key through
 * `keyRef`, hydrates each subject value like a body value, and writes the
 * signed request, base64url DER, to `into`. A key or value that is not text,
 * a key that is not an RSA private key, or a subject the builder cannot
 * encode fails the generator; the step then fails
 * `<step> generate pkcs10-csr failed`.
 */

import { ScraperErrorTypes } from '../../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../../Types/Procedure.js';
import type { ICsrSubjectEntry, IPkcs10CsrGenerator } from '../../ConfigContracts/index.js';
import { buildCsr, type ICsrBuildInput } from '../../Crypto/CsrBuilder.js';
import type { ICsrSubjectValue } from '../../Crypto/CsrSubject.js';
import type { GeneratedCarry } from '../../Crypto/RsaKeyGenerator.js';
import type { JsonValue } from '../../Envelope/JsonPointer.js';
import { hydrate } from '../../Template/GenericBodyTemplate.js';
import { type ITemplateScope, resolveRef } from '../../Template/RefResolver.js';

/** Failure for a key or subject value that is not text — names no value. */
const NOT_TEXT = 'pkcs10-csr input is not text';

/**
 * Narrow a hydrated input to text.
 * @param hydrated - Hydrated key or subject value.
 * @returns Procedure with the text, or a failure naming no value.
 */
function asText(hydrated: Procedure<JsonValue>): Procedure<string> {
  if (!isOk(hydrated)) return hydrated;
  if (typeof hydrated.value !== 'string') return fail(ScraperErrorTypes.Generic, NOT_TEXT);
  return succeed(hydrated.value);
}

/**
 * Hydrate one subject entry.
 * @param entry - Attribute and value template.
 * @param scope - Template scope.
 * @returns Procedure with the attribute and its text.
 */
function hydrateEntry(entry: ICsrSubjectEntry, scope: ITemplateScope): Procedure<ICsrSubjectValue> {
  const hydrated = hydrate(entry.value, scope);
  const text = asText(hydrated);
  if (!isOk(text)) return text;
  return succeed({ attr: entry.attr, value: text.value });
}

/**
 * Hydrate the subject in order; every value must be text.
 * @param subject - Subject entries.
 * @param scope - Template scope.
 * @returns Procedure with every attribute's text.
 */
function hydrateSubject(
  subject: readonly ICsrSubjectEntry[],
  scope: ITemplateScope,
): Procedure<readonly ICsrSubjectValue[]> {
  const hydrated = subject.map(entry => hydrateEntry(entry, scope));
  const texts = hydrated.filter(isOk);
  if (texts.length !== hydrated.length) return fail(ScraperErrorTypes.Generic, NOT_TEXT);
  const values = texts.map(text => text.value);
  return succeed(values);
}

/**
 * The signing key PEM `keyRef` names.
 * @param generator - Generator config.
 * @param scope - Template scope.
 * @returns Procedure with the PEM text.
 */
function keyPemOf(generator: IPkcs10CsrGenerator, scope: ITemplateScope): Procedure<string> {
  const resolved = resolveRef(generator.keyRef, scope);
  return asText(resolved);
}

/**
 * The builder input: the key PEM and the hydrated subject.
 * @param generator - Generator config.
 * @param scope - Template scope.
 * @returns Procedure with the build input.
 */
function csrInput(
  generator: IPkcs10CsrGenerator,
  scope: ITemplateScope,
): Procedure<ICsrBuildInput> {
  const keyPem = keyPemOf(generator, scope);
  if (!isOk(keyPem)) return keyPem;
  const subject = hydrateSubject(generator.subject, scope);
  if (!isOk(subject)) return subject;
  return succeed({ keyPem: keyPem.value, subject: subject.value });
}

/**
 * Build the request and name its slot.
 * @param generator - Generator config.
 * @param input - Key PEM and subject.
 * @returns Procedure with the request under `into`.
 */
function signedSlot(
  generator: IPkcs10CsrGenerator,
  input: ICsrBuildInput,
): Procedure<GeneratedCarry> {
  const csr = buildCsr(input);
  if (csr === false) return fail(ScraperErrorTypes.Generic, 'pkcs10-csr refused');
  return succeed({ [generator.into]: csr });
}

/**
 * Sign a PKCS#10 request with the key `keyRef` names.
 * @param generator - Generator config.
 * @param scope - Scope so far, including slots earlier generators wrote.
 * @returns Procedure with the request under `into`.
 */
function generatePkcs10Csr(
  generator: IPkcs10CsrGenerator,
  scope: ITemplateScope,
): Promise<Procedure<GeneratedCarry>> {
  const input = csrInput(generator, scope);
  const slot = isOk(input) ? signedSlot(generator, input.value) : input;
  return Promise.resolve(slot);
}

export default generatePkcs10Csr;
export { generatePkcs10Csr };
