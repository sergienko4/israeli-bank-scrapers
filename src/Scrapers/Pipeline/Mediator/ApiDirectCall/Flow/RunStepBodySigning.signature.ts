/**
 * `attachBodySignature` — AES-CBC-PKCS7 canonical → sign → write at pointer.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import { signAesCbcPkcs7 } from '../Crypto/AesSymmetricSigner.js';
import { buildCanonical } from '../Crypto/GenericCanonicalStringBuilder.js';
import type { IAesSignerConfig } from '../IApiDirectCallConfig.js';
import type { ITemplateScope } from '../Template/RefResolver.js';
import { writeAtPointer } from './RunStepBodySigning.pointer.js';
import { resolveKeyBytes } from './RunStepBodySigning.refs.js';
import type { DocObj, IAttachBodySignatureArgs } from './RunStepBodySigning.types.js';

/** Args bundle for `signAndWrite` — keeps it short. */
interface ISignAndWriteArgs {
  readonly signer: IAesSignerConfig;
  readonly scope: ITemplateScope;
  readonly body: DocObj;
  readonly pathAndQuery: string;
}

/**
 * Build the AES canonical bytes from the signer config + body + carry.
 * @param args - Sign-and-write args bundle.
 * @returns Procedure with the canonical string.
 */
function buildAesCanonical(args: ISignAndWriteArgs): Procedure<string> {
  const bodyJson = JSON.stringify(args.body);
  return buildCanonical({
    canonical: args.signer.canonical,
    pathAndQuery: args.pathAndQuery,
    bodyJson,
    carry: args.scope.carry,
  });
}

/**
 * Resolve the AES signer IV bytes from carry.
 * @param signer - AES signer config.
 * @param scope - Current scope.
 * @returns Procedure with the IV byte buffer.
 */
function resolveSignerIv(signer: IAesSignerConfig, scope: ITemplateScope): Procedure<Buffer> {
  const ivHex = scope.carry[signer.ivCarrySlot];
  if (typeof ivHex !== 'string') {
    return fail(ScraperErrorTypes.Generic, `signer: carry.${signer.ivCarrySlot} missing`);
  }
  const ivBytes = Buffer.from(ivHex, 'hex');
  return succeed(ivBytes);
}

/** Resolved AES-signer inputs ready to feed signAesCbcPkcs7. */
interface IResolvedSignerInputs {
  readonly canonical: string;
  readonly keyBytes: Buffer;
  readonly ivBytes: Buffer;
}

/**
 * Resolve canonical bytes + key bytes + IV bytes for the AES signer.
 * @param args - Sign-and-write args bundle.
 * @returns Procedure with the resolved inputs.
 */
function resolveSignerInputs(args: ISignAndWriteArgs): Procedure<IResolvedSignerInputs> {
  const canonicalProc = buildAesCanonical(args);
  if (!isOk(canonicalProc)) return canonicalProc;
  const keyProc = resolveKeyBytes(args.signer.keyRef, args.scope);
  if (!isOk(keyProc)) return keyProc;
  const ivProc = resolveSignerIv(args.signer, args.scope);
  if (!isOk(ivProc)) return ivProc;
  const out = { canonical: canonicalProc.value, keyBytes: keyProc.value, ivBytes: ivProc.value };
  return succeed(out);
}

/** Args bundle for `performAesSign` — keeps the signature single-line. */
interface IPerformAesSignArgs {
  readonly inputs: IResolvedSignerInputs;
  readonly signer: IAesSignerConfig;
}

/**
 * Run signAesCbcPkcs7 with the resolved inputs.
 * @param args - Resolved inputs + AES signer config bundle.
 * @returns Procedure with the signature string.
 */
function performAesSign(args: IPerformAesSignArgs): Procedure<string> {
  return signAesCbcPkcs7({
    plaintext: args.inputs.canonical,
    keyBytes: args.inputs.keyBytes,
    ivBytes: args.inputs.ivBytes,
    outputPostfix: args.signer.outputPostfix,
  });
}

/**
 * Compute canonical → sign → write at pointer for the AES signer.
 * @param args - Signing bundle.
 * @returns Procedure with the body (signature written in place).
 */
function signAndWrite(args: ISignAndWriteArgs): Procedure<DocObj> {
  const inputsProc = resolveSignerInputs(args);
  if (!isOk(inputsProc)) return inputsProc;
  const signed = performAesSign({ inputs: inputsProc.value, signer: args.signer });
  if (!isOk(signed)) return signed;
  return writeAtPointer(args.body, args.signer.bodySignatureField, signed.value);
}

/**
 * Build the ISignAndWriteArgs bundle from the public args + narrowed signer.
 * @param args - Attach-body-signature args.
 * @param signer - Validated AES signer.
 * @returns Sign-and-write args bundle.
 */
function makeSignAndWriteArgs(
  args: IAttachBodySignatureArgs,
  signer: IAesSignerConfig,
): ISignAndWriteArgs {
  return { signer, body: args.body, scope: args.scope, pathAndQuery: args.pathAndQuery };
}

/**
 * Sign canonical bytes and write the resulting signature string into
 * the outbound body at `signer.bodySignatureField`.
 * @param args - Signing bundle.
 * @returns Procedure with the updated body.
 */
function attachBodySignature(args: IAttachBodySignatureArgs): Procedure<DocObj> {
  const signer = args.scope.config.signer;
  if (signer === undefined) return succeed(args.body);
  if (signer.algorithm !== 'AES-CBC-PKCS7') return succeed(args.body);
  const swArgs = makeSignAndWriteArgs(args, signer);
  return signAndWrite(swArgs);
}

export default attachBodySignature;

export { attachBodySignature };
