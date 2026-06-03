/**
 * Step-instant carry primer — fresh IVs + `tsMs` seeded before the
 * step body is hydrated.
 */

import { isOk } from '../../../Types/Procedure.js';
import type { JsonValue } from '../Envelope/JsonPointer.js';
import type { ICryptoFieldConfig, ISignerConfig, IStepConfig } from '../IApiDirectCallConfig.js';
import type { ITemplateScope } from '../Template/RefResolver.js';
import { freshIvHex } from './RunStepBodySigning.iv.js';
import { stripCarryPrefix } from './RunStepBodySigning.refs.js';

/** Bundle for `writeCryptoIvSlot` — slot RefToken + carry target. */
interface ISeedCryptoIvArgs {
  readonly cryptoField: ICryptoFieldConfig;
  readonly carry: Record<string, JsonValue>;
}

/**
 * Seed a fresh IV hex into `carry[cryptoField.ivRef-slot]` when undefined.
 * @param args - cryptoField + mutable carry target.
 * @returns true once the slot is present (existing or freshly set).
 */
function writeCryptoIvSlot(args: ISeedCryptoIvArgs): boolean {
  const slotProc = stripCarryPrefix(args.cryptoField.ivRef);
  if (!isOk(slotProc)) return false;
  const slot = slotProc.value;
  if (slot in args.carry) return true;
  args.carry[slot] = freshIvHex();
  return true;
}

/**
 * Seed the AES-signer IV slot when configured.
 * @param carry - Mutable carry record.
 * @param signer - Resolved signer config (may be undefined).
 * @returns Sentinel true.
 */
function primeAesSignerIv(carry: Record<string, JsonValue>, signer?: ISignerConfig): true {
  if (signer?.algorithm === 'AES-CBC-PKCS7') {
    carry[signer.ivCarrySlot] = freshIvHex();
  }
  return true;
}

/**
 * Seed the cryptoField IV slot when the step has a preHook.cryptoField.
 * @param carry - Mutable carry record.
 * @param step - Step config.
 * @returns Sentinel true.
 */
function primeCryptoFieldIv(carry: Record<string, JsonValue>, step: IStepConfig): true {
  const cryptoField = step.preHook?.cryptoField;
  if (cryptoField !== undefined) {
    writeCryptoIvSlot({ cryptoField, carry });
  }
  return true;
}

/**
 * Prime step-local carry slots: fresh `tsMs` + signing IV (AES) +
 * cryptoField IV when the step uses one.
 * @param scope - Current scope (read-only).
 * @param step - The step about to run (for cryptoField.ivRef).
 * @returns Scope with primed carry.
 */
function primeStepCarry(scope: ITemplateScope, step: IStepConfig): ITemplateScope {
  const nowMs = Date.now();
  const tsMs = String(nowMs);
  const carry: Record<string, JsonValue> = { ...scope.carry, tsMs };
  primeAesSignerIv(carry, scope.config.signer);
  primeCryptoFieldIv(carry, step);
  return { ...scope, carry };
}

export default primeStepCarry;

export { primeStepCarry };
