/**
 * RunStepBodySigning barrel — step-instant carry primer + cryptoField
 * encryption + AES body-pointer signature attachment.
 *
 * Re-exports from co-located siblings: `.types`, `.iv`, `.refs`,
 * `.prime`, `.pointer`, `.cryptofield`, `.signature`.
 */

export { applyCryptoField } from './RunStepBodySigning.cryptofield.js';
export { writeAtPointer } from './RunStepBodySigning.pointer.js';
export { primeStepCarry } from './RunStepBodySigning.prime.js';
export { attachBodySignature } from './RunStepBodySigning.signature.js';
export type {
  IApplyCryptoFieldArgs,
  IAttachBodySignatureArgs,
} from './RunStepBodySigning.types.js';
