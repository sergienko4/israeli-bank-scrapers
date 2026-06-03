/**
 * Seed-from-creds helpers: read creds + bootstrap fallback, and the
 * top-level reducer `applySeedCarry`.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { JsonValue } from '../Envelope/JsonPointer.js';
import type { IApiDirectCallConfig, ISeedCarrySource } from '../IApiDirectCallConfig.js';
import { evalBootstrap } from './FlowInitCarry.bootstrap.js';
import type { CarryMut, Creds, IReduceSeedCtx, SeedSourceEntry } from './FlowInitCarry.types.js';

/**
 * Coerce a creds value into a JsonValue Procedure — pass-through for
 * `null` / scalars, fail otherwise.
 * @param raw - Raw creds value.
 * @returns Procedure with the JsonValue.
 */
function coerceCredsValue(raw: unknown): Procedure<JsonValue> {
  if (raw === null) return succeed(null);
  const t = typeof raw;
  if (t === 'string' || t === 'number' || t === 'boolean') return succeed(raw as JsonValue);
  return fail(ScraperErrorTypes.Generic, `seed value is not JSON-serialisable: ${t}`);
}

/**
 * Standard failure for absent creds with no bootstrap configured.
 * @param field - Creds field name.
 * @returns Procedure failure.
 */
function noBootstrapFail(field: string): Procedure<JsonValue> {
  return fail(
    ScraperErrorTypes.Generic,
    `seedCarryFromCreds: creds.${field} absent and no bootstrap configured`,
  );
}

/**
 * Evaluate one `ISeedCarrySource` entry: mirror the creds field when
 * present + non-empty, fall back to the bootstrap when configured, or
 * fail when neither is available.
 * @param entry - Single seed source.
 * @param creds - Caller credentials.
 * @returns Procedure with the resolved JsonValue.
 */
function evalSeedSource(entry: ISeedCarrySource, creds: Creds): Procedure<JsonValue> {
  const raw = creds[entry.field];
  const coerced = coerceCredsValue(raw);
  if (isOk(coerced) && coerced.value !== '') return coerced;
  if (entry.bootstrap === undefined) return noBootstrapFail(entry.field);
  return evalBootstrap(entry.bootstrap, creds);
}

/**
 * Normalise a SeedSourceEntry to an ISeedCarrySource shape.
 * @param entry - Bare field name or source spec.
 * @returns Source spec with the field set.
 */
function normaliseSeedEntry(entry: SeedSourceEntry): ISeedCarrySource {
  if (typeof entry === 'string') return { field: entry };
  return entry;
}

/**
 * Apply one normalised seed entry to the carry accumulator.
 * @param entry - Already-normalised seed source.
 * @param creds - Caller credentials.
 * @param carry - Mutable carry accumulator.
 * @returns Procedure with the mutated carry.
 */
function applyOneSeed(entry: ISeedCarrySource, creds: Creds, carry: CarryMut): Procedure<CarryMut> {
  const proc = evalSeedSource(entry, creds);
  if (!isOk(proc)) return proc;
  carry[entry.field] = proc.value;
  return succeed(carry);
}

/**
 * Reducer step for the seed-loop.
 * @param acc - Accumulator procedure (carries the mutated map).
 * @param ctx - Bundle carrying creds + carry-target + the raw entry.
 * @returns Updated accumulator procedure.
 */
function reduceSeed(acc: Procedure<CarryMut>, ctx: IReduceSeedCtx): Procedure<CarryMut> {
  if (!isOk(acc)) return acc;
  const entry = normaliseSeedEntry(ctx.entry);
  return applyOneSeed(entry, ctx.creds, ctx.carry);
}

/** Args bundle for `applySeedCarry` — keeps the signature single-line. */
interface IApplySeedCarryArgs {
  readonly config: IApiDirectCallConfig;
  readonly creds: Creds;
  readonly carry: CarryMut;
}

/**
 * Apply all `seedCarryFromCreds` entries to the carry accumulator.
 * @param args - Config + creds + carry bundle.
 * @returns Procedure with the mutated carry.
 */
function applySeedCarry(args: IApplySeedCarryArgs): Procedure<CarryMut> {
  const { config, creds, carry } = args;
  const entries = config.seedCarryFromCreds ?? [];
  const seed: Procedure<CarryMut> = succeed(carry);
  return entries.reduce<Procedure<CarryMut>>(
    (acc, rawEntry) => reduceSeed(acc, { entry: rawEntry, creds, carry }),
    seed,
  );
}

export { applySeedCarry };
export type { IApplySeedCarryArgs };
