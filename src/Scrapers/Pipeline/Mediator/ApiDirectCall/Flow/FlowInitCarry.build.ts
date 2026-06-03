/**
 * Public entrypoint: `buildInitialCarry` — runs `seedCarryFromCreds`
 * + `derivedCarry` against the initial carry accumulator. Preserves
 * the historical (config, creds, initialCarry) positional signature.
 */

import type { Procedure } from '../../../Types/Procedure.js';
import { isOk } from '../../../Types/Procedure.js';
import type { JsonValue } from '../Envelope/JsonPointer.js';
import type { IApiDirectCallConfig } from '../IApiDirectCallConfig.js';
import { applyDerivedCarry } from './FlowInitCarry.derived.js';
import { applySeedCarry } from './FlowInitCarry.seed.js';
import type { CarryMut, Creds } from './FlowInitCarry.types.js';

/** Public initial-carry shape (frozen view over the mutable accumulator). */
type InitialCarry = Readonly<Record<string, JsonValue>>;

/** Internal bundle for `applyAll` — keeps signatures short + uniform. */
interface IApplyAllArgs {
  readonly config: IApiDirectCallConfig;
  readonly creds: Creds;
  readonly carry: CarryMut;
}

/**
 * Apply seed-carry then derived-carry to the accumulator.
 * @param args - Config + creds + mutable carry bundle.
 * @returns Procedure with the fully-mutated carry.
 */
function applyAll(args: IApplyAllArgs): Procedure<CarryMut> {
  const seedProc = applySeedCarry({ config: args.config, creds: args.creds, carry: args.carry });
  if (!isOk(seedProc)) return seedProc;
  return applyDerivedCarry({ config: args.config, creds: args.creds, carry: seedProc.value });
}

/**
 * Run `seedCarryFromCreds` + `derivedCarry` against the initial carry.
 * @param config - API-direct-call config.
 * @param creds - Caller credentials.
 * @param initialCarry - Carry seeded by the caller (e.g. flowId, warm-start).
 * @returns Procedure with the full initial carry.
 */
function buildInitialCarry(
  config: IApiDirectCallConfig,
  creds: Creds,
  initialCarry: InitialCarry,
): Procedure<InitialCarry> {
  const carry: CarryMut = { ...initialCarry };
  return applyAll({ config, creds, carry });
}

export default buildInitialCarry;

export { buildInitialCarry };
export type { InitialCarry };
