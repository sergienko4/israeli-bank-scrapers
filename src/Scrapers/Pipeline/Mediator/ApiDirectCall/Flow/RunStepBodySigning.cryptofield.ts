/**
 * `applyCryptoField` — encrypt a per-step plaintext slot and write the
 * ciphertext into the outbound body, scrubbing the plaintext from carry.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import { signAesCbcPkcs7 } from '../Crypto/AesSymmetricSigner.js';
import type { JsonValue } from '../Envelope/JsonPointer.js';
import type { ICryptoFieldConfig } from '../IApiDirectCallConfig.js';
import type { ITemplateScope } from '../Template/RefResolver.js';
import { writeAtPointer } from './RunStepBodySigning.pointer.js';
import { resolveIvBytes, resolveKeyBytes } from './RunStepBodySigning.refs.js';
import type {
  DocObj,
  IApplyCryptoFieldArgs,
  ICryptoFieldResult,
} from './RunStepBodySigning.types.js';

/** Resolved bytes for the cryptoField AES key. */
interface IResolvedKeyAndIv {
  readonly keyBytes: Buffer;
  readonly ivBytes: Buffer;
}

/**
 * Resolve the key and IV byte buffers for a cryptoField step.
 * @param cryptoField - The cryptoField config.
 * @param scope - Current scope.
 * @returns Procedure with both buffers.
 */
function resolveCryptoFieldKeyIv(
  cryptoField: ICryptoFieldConfig,
  scope: ITemplateScope,
): Procedure<IResolvedKeyAndIv> {
  const keyProc = resolveKeyBytes(cryptoField.keyRef, scope);
  if (!isOk(keyProc)) return keyProc;
  const ivProc = resolveIvBytes(cryptoField.ivRef, scope);
  if (!isOk(ivProc)) return ivProc;
  return succeed({ keyBytes: keyProc.value, ivBytes: ivProc.value });
}

/** Args bundle for `encryptAndWrite` — keeps the helper short. */
interface IEncryptAndWriteArgs extends IApplyCryptoFieldArgs {
  readonly cryptoField: ICryptoFieldConfig;
  readonly plaintext: string;
}

/**
 * Remove a carry slot — returns a new scope with the slot omitted.
 * @param scope - Current scope.
 * @param slot - Carry slot to omit.
 * @returns New scope without the slot.
 */
function scrubFromCarry(scope: ITemplateScope, slot: string): ITemplateScope {
  const carryEntries = Object.entries(scope.carry).filter(([k]): boolean => k !== slot);
  const filtered = Object.fromEntries(carryEntries) as Record<string, JsonValue>;
  return { ...scope, carry: filtered };
}

/** Inputs for `signAesCbcPkcs7` extracted from cryptoField args. */
interface IEncryptInputs {
  readonly plaintext: string;
  readonly keyBytes: Buffer;
  readonly ivBytes: Buffer;
  readonly outputPostfix: ICryptoFieldConfig['outputPostfix'];
}

/**
 * Build the AES-encrypt inputs from the cryptoField args + resolved bytes.
 * @param args - Encrypt-and-write args bundle.
 * @param keyIv - Resolved key/IV byte buffers.
 * @returns Encrypt inputs.
 */
function buildEncryptInputs(args: IEncryptAndWriteArgs, keyIv: IResolvedKeyAndIv): IEncryptInputs {
  return {
    plaintext: args.plaintext,
    keyBytes: keyIv.keyBytes,
    ivBytes: keyIv.ivBytes,
    outputPostfix: args.cryptoField.outputPostfix,
  };
}

/**
 * Write the ciphertext into the body and scrub the carry plaintext.
 * @param args - Encrypt-and-write args bundle.
 * @param signed - Ciphertext to write.
 * @returns Procedure with updated body + scope.
 */
function writeAndScrub(args: IEncryptAndWriteArgs, signed: string): Procedure<ICryptoFieldResult> {
  const writeProc = writeAtPointer(args.body, args.cryptoField.writeTo, signed);
  if (!isOk(writeProc)) return writeProc;
  const nextScope = scrubFromCarry(args.scope, args.cryptoField.scrubFromCarry);
  return succeed({ body: writeProc.value, scope: nextScope });
}

/**
 * Resolve key+iv, encrypt plaintext, write ciphertext to body, scrub carry.
 * @param args - Encryption bundle.
 * @returns Procedure with updated (body, scope).
 */
function encryptAndWrite(args: IEncryptAndWriteArgs): Procedure<ICryptoFieldResult> {
  const keyIvProc = resolveCryptoFieldKeyIv(args.cryptoField, args.scope);
  if (!isOk(keyIvProc)) return keyIvProc;
  const inputs = buildEncryptInputs(args, keyIvProc.value);
  const signed = signAesCbcPkcs7(inputs);
  if (!isOk(signed)) return signed;
  return writeAndScrub(args, signed.value);
}

/**
 * Resolve the cryptoField plaintext from carry.
 * @param scope - Current scope.
 * @param intoCarryField - Carry slot holding the plaintext.
 * @returns Procedure with the plaintext string.
 */
function resolvePlaintext(scope: ITemplateScope, intoCarryField: string): Procedure<string> {
  const value = scope.carry[intoCarryField];
  if (typeof value !== 'string') {
    const msg = `cryptoField: carry.${intoCarryField} missing or non-string`;
    return fail(ScraperErrorTypes.Generic, msg);
  }
  return succeed(value);
}

/**
 * Build the encrypt-and-write args bundle once plaintext has been resolved.
 * @param args - apply args.
 * @param cryptoField - Resolved cryptoField config.
 * @param plaintext - Plaintext string from carry.
 * @returns Bundle ready for `encryptAndWrite`.
 */
function buildEncryptAndWriteArgs(
  args: IApplyCryptoFieldArgs,
  cryptoField: ICryptoFieldConfig,
  plaintext: string,
): IEncryptAndWriteArgs {
  return { cryptoField, plaintext, ...args };
}

/**
 * Resolve the hook + cryptoField config, returning a no-op short-circuit
 * when either is absent.
 * @param args - apply args.
 * @returns Procedure with the cryptoField + plaintext-bearing hook.
 */
function resolveHook(
  args: IApplyCryptoFieldArgs,
): Procedure<{ readonly cryptoField: ICryptoFieldConfig; readonly intoCarryField: string }> {
  const hook = args.step.preHook;
  const cryptoField = hook?.cryptoField;
  if (hook === undefined || cryptoField === undefined) {
    return fail(ScraperErrorTypes.Generic, 'noop');
  }
  return succeed({ cryptoField, intoCarryField: hook.intoCarryField });
}

/**
 * Apply the optional per-step cryptoField — encrypt the carry value
 * named by `preHook.intoCarryField` and write the result into the body.
 * @param args - Step + scope + body bundle.
 * @returns Procedure with updated (body, scope).
 */
function applyCryptoField(args: IApplyCryptoFieldArgs): Procedure<ICryptoFieldResult> {
  const hookProc = resolveHook(args);
  if (!isOk(hookProc)) return succeed({ body: args.body, scope: args.scope });
  const plaintextProc = resolvePlaintext(args.scope, hookProc.value.intoCarryField);
  if (!isOk(plaintextProc)) return plaintextProc;
  const { cryptoField } = hookProc.value;
  const encryptArgs = buildEncryptAndWriteArgs(args, cryptoField, plaintextProc.value);
  return encryptAndWrite(encryptArgs);
}

/** Re-export of the doc-object alias to keep the cryptofield surface self-contained. */

export { applyCryptoField };
export type { DocObj };
