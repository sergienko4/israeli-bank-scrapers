/**
 * Seed-from-creds helpers: read creds + bootstrap fallback, and the
 * top-level reducer `applySeedCarry`.
 */

import { ScraperErrorTypes } from '../../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../../Types/Procedure.js';
import type { IApiDirectCallConfig, ISeedCarrySource } from '../../ConfigContracts/index.js';
import type { JsonValue } from '../../Envelope/JsonPointer.js';
import { evalBootstrap } from './FlowInitCarry.bootstrap.js';
import { evalRandomBootstrap, isRandomBootstrap } from './FlowInitCarry.random.js';
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
 * Draw an unconditional random seed, ignoring credential and initial values.
 * @param entry - Seed source.
 * @returns Fresh random value or an invalid-policy failure.
 */
function evalFreshSeed(entry: ISeedCarrySource): Procedure<JsonValue> {
  const bootstrap = entry.bootstrap;
  if (entry.alwaysBootstrap !== true || bootstrap === undefined || !isRandomBootstrap(bootstrap))
    return fail(
      ScraperErrorTypes.Generic,
      'seedCarryFromCreds: alwaysBootstrap needs a random bootstrap',
    );
  return evalRandomBootstrap(bootstrap);
}

/**
 * Resolve a seeded field's shipped default from `config.secrets`.
 * @param entry - Seed source naming the secret.
 * @param secrets - Bank secret map.
 * @returns The secret value, or a typed failure when the secret is absent.
 */
function evalFallbackSecret(
  entry: ISeedCarrySource,
  secrets: Readonly<Record<string, string>>,
): Procedure<JsonValue> {
  const name = entry.fallbackSecret ?? '';
  const value: unknown = Object.hasOwn(secrets, name) ? secrets[name] : '';
  if (typeof value === 'string' && value !== '') return succeed(value);
  const message = `seedCarryFromCreds: config.secrets.${name} absent and no bootstrap configured`;
  return fail(ScraperErrorTypes.Generic, message);
}

/**
 * Resolve a seed whose creds field is absent: shipped secret, then
 * bootstrap, else a typed failure.
 * @param entry - Single seed source.
 * @param creds - Caller credentials (bootstrap input).
 * @param secrets - Bank secret map.
 * @returns Procedure with the resolved JsonValue.
 */
function evalAbsentSeed(
  entry: ISeedCarrySource,
  creds: Creds,
  secrets: Readonly<Record<string, string>>,
): Procedure<JsonValue> {
  if (entry.fallbackSecret !== undefined) return evalFallbackSecret(entry, secrets);
  if (entry.bootstrap === undefined) return noBootstrapFail(entry.field);
  return evalBootstrap(entry.bootstrap, creds);
}

/**
 * Evaluate one `ISeedCarrySource` entry: mirror the creds field when
 * present + non-empty, otherwise resolve the configured fallback.
 * @param entry - Single seed source.
 * @param creds - Caller credentials.
 * @param secrets - Bank secret map.
 * @returns Procedure with the resolved JsonValue.
 */
function evalSeedSource(
  entry: ISeedCarrySource,
  creds: Creds,
  secrets: Readonly<Record<string, string>>,
): Procedure<JsonValue> {
  if (entry.alwaysBootstrap !== undefined) return evalFreshSeed(entry);
  const coerced = coerceCredsValue(creds[entry.field]);
  if (isOk(coerced) && coerced.value !== '') return coerced;
  return evalAbsentSeed(entry, creds, secrets);
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
 * @param ctx - Seed context (entry, creds, carry, secrets).
 * @returns Procedure with the mutated carry.
 */
function applyOneSeed(ctx: IReduceSeedCtx): Procedure<CarryMut> {
  const entry = normaliseSeedEntry(ctx.entry);
  const proc = evalSeedSource(entry, ctx.creds, ctx.secrets);
  if (!isOk(proc)) return proc;
  ctx.carry[entry.field] = proc.value;
  return succeed(ctx.carry);
}

/**
 * Reducer step for the seed-loop.
 * @param acc - Accumulator procedure (carries the mutated map).
 * @param ctx - Bundle carrying creds + carry-target + secrets + the raw entry.
 * @returns Updated accumulator procedure.
 */
function reduceSeed(acc: Procedure<CarryMut>, ctx: IReduceSeedCtx): Procedure<CarryMut> {
  if (!isOk(acc)) return acc;
  return applyOneSeed(ctx);
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
  const secrets = config.secrets ?? {};
  const entries = config.seedCarryFromCreds ?? [];
  const seed: Procedure<CarryMut> = succeed(carry);
  return entries.reduce<Procedure<CarryMut>>(
    (acc, entry) => reduceSeed(acc, { entry, creds, carry, secrets }),
    seed,
  );
}

export { applySeedCarry };
export type { IApplySeedCarryArgs };
