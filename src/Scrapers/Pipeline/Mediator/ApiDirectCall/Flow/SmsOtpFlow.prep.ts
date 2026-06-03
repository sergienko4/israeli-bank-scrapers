/**
 * Prep helpers: keypair generation, fingerprint collection, scope-seed
 * construction, initial-carry merge, and the top-level prepareSmsOtpFlow.
 */

import { randomUUID } from 'node:crypto';

import type { Procedure } from '../../../Types/Procedure.js';
import { isOk, succeed } from '../../../Types/Procedure.js';
import { generateKeypair } from '../Crypto/CryptoKeyFactory.js';
import type { JsonValue } from '../Envelope/JsonPointer.js';
import type { ICollectionResult } from '../Fingerprint/GenericFingerprintBuilder.js';
import { buildCollectionResult } from '../Fingerprint/GenericFingerprintBuilder.js';
import type { IApiDirectCallConfig } from '../IApiDirectCallConfig.js';
import type { ITemplateScope } from '../Template/RefResolver.js';
import { buildInitialCarry } from './FlowInitCarry.js';
import type {
  ICoreSmsOtpInputs,
  IKeypairBundle,
  IRunSmsOtpArgs,
  ISeedArgs,
  ISmsOtpPrep,
} from './SmsOtpFlow.types.js';

/**
 * Generate both EC and RSA keypairs when config.signer is asymmetric.
 * @param config - API-direct-call config.
 * @returns Procedure with keypair bundle (empty when no signer or AES).
 */
function prepareKeypairs(config: IApiDirectCallConfig): Procedure<IKeypairBundle> {
  if (config.signer === undefined) return succeed({});
  if (config.signer.algorithm === 'AES-CBC-PKCS7') return succeed({});
  const ecProc = generateKeypair('ECDSA-P256');
  if (!isOk(ecProc)) return ecProc;
  const rsaProc = generateKeypair('RSA-2048');
  if (!isOk(rsaProc)) return rsaProc;
  return succeed({ ec: ecProc.value, rsa: rsaProc.value });
}

/**
 * Build the fingerprint collection block when config.fingerprint is set.
 * @param config - API-direct-call config.
 * @returns Procedure with the collection result (or false when absent).
 */
function prepareFingerprint(config: IApiDirectCallConfig): Procedure<ICollectionResult | false> {
  if (config.fingerprint === undefined) return succeed(false);
  return buildCollectionResult(config.fingerprint, config);
}

/**
 * Build the partial-slot set for the scope (only sets what's present).
 * @param keypairs - Generated keypair bundle.
 * @param fp - Fingerprint result or false.
 * @returns Partial scope containing only the present slots.
 */
function buildScopeSlots(
  keypairs: IKeypairBundle,
  fp: ICollectionResult | false,
): Pick<ITemplateScope, 'keypair' | 'fingerprint'> {
  const hasKeys = keypairs.ec !== undefined || keypairs.rsa !== undefined;
  const slots: { keypair?: IKeypairBundle; fingerprint?: ICollectionResult } = {};
  if (hasKeys) slots.keypair = keypairs;
  if (fp !== false) slots.fingerprint = fp;
  return slots;
}

/**
 * Seed the template scope for the first step.
 * @param args - Seed args.
 * @returns Initial scope.
 */
function seedScope(args: ISeedArgs): ITemplateScope {
  const slots = buildScopeSlots(args.keypairs, args.fingerprint);
  return {
    carry: { ...args.initialCarry },
    creds: args.creds,
    config: args.config,
    ...slots,
  };
}

/**
 * Merge the provided warm-start carry (if any) over the base seed.
 * @param baseSeed - System-generated carry (flowId etc).
 * @param args - Flow args (for access to initialCarry).
 * @returns Merged readonly carry.
 */
function mergeInitialCarry(
  baseSeed: Record<string, JsonValue>,
  args: IRunSmsOtpArgs,
): Readonly<Record<string, JsonValue>> {
  if (args.initialCarry === undefined) return baseSeed;
  return { ...baseSeed, ...args.initialCarry };
}

/**
 * Build the initial carry (system seed + caller initialCarry merged via buildInitialCarry).
 * @param args - Flow run args.
 * @returns Initial carry procedure.
 */
function buildSmsOtpCarry(args: IRunSmsOtpArgs): Procedure<Readonly<Record<string, JsonValue>>> {
  const baseSeed: Record<string, JsonValue> = { flowId: randomUUID() };
  const merged = mergeInitialCarry(baseSeed, args);
  return buildInitialCarry(args.config, args.creds, merged);
}

/**
 * Prepare the keypairs + fingerprint bundle (no carry build).
 * @param args - Flow run args.
 * @returns Core inputs procedure.
 */
function prepCoreInputs(args: IRunSmsOtpArgs): Procedure<ICoreSmsOtpInputs> {
  const keypairsProc = prepareKeypairs(args.config);
  if (!isOk(keypairsProc)) return keypairsProc;
  const fpProc = prepareFingerprint(args.config);
  if (!isOk(fpProc)) return fpProc;
  return succeed({ keypairs: keypairsProc.value, fingerprint: fpProc.value });
}

/**
 * Prepare keypairs, fingerprint, and initial carry for the flow.
 * @param args - Flow run args.
 * @returns Prepared bundle procedure.
 */
function prepareSmsOtpFlow(args: IRunSmsOtpArgs): Procedure<ISmsOtpPrep> {
  const coreProc = prepCoreInputs(args);
  if (!isOk(coreProc)) return coreProc;
  const carryProc = buildSmsOtpCarry(args);
  if (!isOk(carryProc)) return carryProc;
  return succeed({ ...coreProc.value, initialCarry: carryProc.value });
}

export { prepareFingerprint, prepareKeypairs, prepareSmsOtpFlow, seedScope };
