/**
 * Flow-init carry helpers — `seedCarryFromCreds` + `derivedCarry`
 * evaluation. Run BEFORE the step reducer iterates so the resulting
 * carry slots are available to body templates + signers via
 * `$ref: carry.<slot>`.
 *
 * Zero bank knowledge. Rule #11 compliant.
 */

import { createHash, randomBytes } from 'node:crypto';

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { JsonValue } from '../Envelope/JsonPointer.js';
import type {
  IApiDirectCallConfig,
  IDerivedCarry,
  ISeedCarrySource,
  RefToken,
  SeedCarryBootstrapKind,
} from '../IApiDirectCallConfig.js';

/** Random-hex generator size used by the `'random-hex-16'` bootstrap. */
const RANDOM_HEX_16_BYTES = 16;

/** Hex prefix length produced by the `'sha256-prefix-16'` bootstrap. */
const SHA256_PREFIX_LENGTH = 16;

/** Mutable carry accumulator used while flow-init runs. */
type CarryMut = Record<string, JsonValue>;

/**
 * Generate a fresh random-hex string of the configured byte length.
 * Wrapped in a Procedure for the bootstrap-dispatch table — keeps the
 * caller from receiving an undefined when an unknown kind is added.
 * @returns Procedure with the generated value.
 */
function bootstrapRandomHex16(): Procedure<string> {
  const hex = randomBytes(RANDOM_HEX_16_BYTES).toString('hex');
  return succeed(hex);
}

/**
 * Deterministically derive a 16-character hex prefix from another
 * creds field. Used for warm-start-stable per-user identifiers
 * (e.g. `deviceId16Hex` derived from `phoneNumber`) so banks whose
 * server has bound a long-term token to such an identifier do not
 * need the caller to persist the identifier separately.
 * @param from - Creds field name whose UTF-8 bytes are hashed.
 * @param creds - Caller credentials.
 * @returns Procedure with the 16-hex prefix (lowercase).
 */
function bootstrapSha256Prefix16(
  from: string,
  creds: Readonly<Record<string, unknown>>,
): Procedure<string> {
  const raw = creds[from];
  if (typeof raw !== 'string' || raw.length === 0) {
    return fail(
      ScraperErrorTypes.Generic,
      `sha256-prefix-16 bootstrap: creds.${from} missing or empty`,
    );
  }
  const digest = createHash('sha256').update(raw, 'utf8').digest('hex');
  const prefix = digest.slice(0, SHA256_PREFIX_LENGTH);
  return succeed(prefix);
}

/**
 * Dispatch a bootstrap kind to its generator. Extracted so the
 * outer {@link evalSeedSource} stays inside the per-function depth
 * budget when a new kind is added.
 * @param bootstrap - Bootstrap kind (string for parameterless,
 *   object for parameterised generators).
 * @param creds - Caller credentials (consulted by parameterised kinds).
 * @returns Procedure with the bootstrap-produced value.
 */
function evalBootstrap(
  bootstrap: SeedCarryBootstrapKind,
  creds: Readonly<Record<string, unknown>>,
): Procedure<string> {
  if (bootstrap === 'random-hex-16') return bootstrapRandomHex16();
  return bootstrapSha256Prefix16(bootstrap.from, creds);
}

/**
 * Coerce a creds value into a JsonValue Procedure — pass-through for
 * `null` / scalars, fail otherwise. Replaces the prior nullable
 * helper so the caller chains via {@link isOk} (Rule P5).
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
 * Evaluate one {@link ISeedCarrySource} entry: mirror the creds field
 * when present + non-empty, fall back to the bootstrap when
 * configured, or fail when neither is available.
 * @param entry - Single seed source.
 * @param creds - Caller credentials.
 * @returns Procedure with the resolved JsonValue.
 */
function evalSeedSource(
  entry: ISeedCarrySource,
  creds: Readonly<Record<string, unknown>>,
): Procedure<JsonValue> {
  const raw = creds[entry.field];
  const coerced = coerceCredsValue(raw);
  if (isOk(coerced) && coerced.value !== '') return coerced;
  if (entry.bootstrap === undefined) {
    return fail(
      ScraperErrorTypes.Generic,
      `seedCarryFromCreds: creds.${entry.field} absent and no bootstrap configured`,
    );
  }
  return evalBootstrap(entry.bootstrap, creds);
}

/** One seed-source entry can be a bare field name or a full source spec. */
type SeedSourceEntry = string | ISeedCarrySource;

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
 * Extracted from the outer loop so the seed iteration body stays
 * inside the per-function depth budget.
 * @param entry - Already-normalised seed source.
 * @param creds - Caller credentials.
 * @param carry - Mutable carry accumulator.
 * @returns Procedure with the mutated carry.
 */
function applyOneSeed(
  entry: ISeedCarrySource,
  creds: Readonly<Record<string, unknown>>,
  carry: CarryMut,
): Procedure<CarryMut> {
  const proc = evalSeedSource(entry, creds);
  if (!isOk(proc)) return proc;
  carry[entry.field] = proc.value;
  return succeed(carry);
}

/** Bundle for {@link reduceSeed} — carries the loop's stable context. */
interface IReduceSeedCtx {
  readonly entry: SeedSourceEntry;
  readonly creds: Readonly<Record<string, unknown>>;
  readonly carry: CarryMut;
}

/**
 * Reducer step for the seed-loop — applies one entry to the carry
 * accumulator (or short-circuits on the first failure). Lifted out
 * of the for-loop so the per-function depth budget stays at 1.
 * @param acc - Accumulator procedure (carries the mutated map).
 * @param ctx - Bundle carrying creds + carry-target + the raw entry.
 * @returns Updated accumulator procedure.
 */
function reduceSeed(acc: Procedure<CarryMut>, ctx: IReduceSeedCtx): Procedure<CarryMut> {
  if (!isOk(acc)) return acc;
  const entry = normaliseSeedEntry(ctx.entry);
  return applyOneSeed(entry, ctx.creds, ctx.carry);
}

/**
 * Apply all `seedCarryFromCreds` entries to the carry accumulator.
 * @param config - API-direct-call config.
 * @param creds - Caller credentials.
 * @param carry - Mutable carry accumulator.
 * @returns Procedure with the mutated carry.
 */
function applySeedCarry(
  config: IApiDirectCallConfig,
  creds: Readonly<Record<string, unknown>>,
  carry: CarryMut,
): Procedure<CarryMut> {
  const entries = config.seedCarryFromCreds ?? [];
  const seed: Procedure<CarryMut> = succeed(carry);
  return entries.reduce<Procedure<CarryMut>>(
    (acc, rawEntry) => reduceSeed(acc, { entry: rawEntry, creds, carry }),
    seed,
  );
}

/** Args bundle for {@link resolveDerivedPart} — keeps params ≤3. */
interface IResolveDerivedPartArgs {
  readonly part: RefToken;
  readonly creds: Readonly<Record<string, unknown>>;
  readonly config: IApiDirectCallConfig;
  readonly carry: Readonly<CarryMut>;
}

/**
 * Resolve a single {@link IDerivedCarry} part — RefToken targeting
 * `carry.<slot>`, `creds.<field>`, or `config.<dotted.path>`.
 * @param args - Bundle (part + creds + config + carry).
 * @returns Procedure with the part value as string.
 */
function resolveDerivedPart(args: IResolveDerivedPartArgs): Procedure<string> {
  const part = args.part;
  if (part.startsWith('carry.')) {
    const slot = part.slice('carry.'.length);
    return carryString(slot, args.carry);
  }
  if (part.startsWith('creds.')) {
    const field = part.slice('creds.'.length);
    return credsString(field, args.creds);
  }
  if (part.startsWith('config.')) {
    const dotted = part.slice('config.'.length);
    return configString(dotted, args.config);
  }
  return fail(ScraperErrorTypes.Generic, `derivedCarry part not supported: ${part as string}`);
}

/**
 * Stringify a carry slot lookup with a clear missing-slot diagnostic.
 * @param slot - Slot name.
 * @param carry - Carry accumulator.
 * @returns Procedure with the string value.
 */
function carryString(slot: string, carry: Readonly<CarryMut>): Procedure<string> {
  const value = carry[slot];
  if (typeof value !== 'string') {
    return fail(ScraperErrorTypes.Generic, `derivedCarry: carry.${slot} missing or non-string`);
  }
  return succeed(value);
}

/**
 * Stringify a creds-field lookup with a clear missing-field diagnostic.
 * @param field - Creds field name.
 * @param creds - Caller credentials.
 * @returns Procedure with the string value.
 */
function credsString(field: string, creds: Readonly<Record<string, unknown>>): Procedure<string> {
  const value = creds[field];
  if (typeof value !== 'string') {
    return fail(ScraperErrorTypes.Generic, `derivedCarry: creds.${field} missing or non-string`);
  }
  return succeed(value);
}

/** Args bundle for {@link walkConfigPath} — keeps the helper short. */
interface IWalkConfigArgs {
  readonly cursor: unknown;
  readonly segments: readonly string[];
  readonly dotted: string;
}

/**
 * Step the dotted-path walker one segment forward. Extracted so the
 * outer loop body stays at depth-1.
 * @param args - Walk bundle.
 * @returns Procedure with the next cursor.
 */
function stepConfigPath(args: IWalkConfigArgs): Procedure<unknown> {
  if (args.cursor === null || typeof args.cursor !== 'object') {
    return fail(ScraperErrorTypes.Generic, `derivedCarry: config.${args.dotted} miss`);
  }
  const head = args.segments[0];
  const child = (args.cursor as Record<string, unknown>)[head];
  return succeed(child);
}

/** Bundle for {@link reduceConfigPath} — one segment + the full dotted path. */
interface IReduceConfigPathCtx {
  readonly segment: string;
  readonly dotted: string;
}

/**
 * Reducer step for the config-path walker — steps one segment and
 * carries the procedure short-circuit.
 * @param acc - Accumulator procedure (current cursor).
 * @param ctx - Bundle with dotted path + remaining-segments info.
 * @returns Updated cursor procedure.
 */
function reduceConfigPath(acc: Procedure<unknown>, ctx: IReduceConfigPathCtx): Procedure<unknown> {
  if (!isOk(acc)) return acc;
  return stepConfigPath({ cursor: acc.value, segments: [ctx.segment], dotted: ctx.dotted });
}

/**
 * Walk a dotted path through `config` and stringify the leaf.
 * @param dotted - Dotted path like `secrets.signKey`.
 * @param config - API-direct-call config.
 * @returns Procedure with the string value.
 */
function configString(dotted: string, config: IApiDirectCallConfig): Procedure<string> {
  const segments = dotted.split('.');
  const seed: Procedure<unknown> = succeed(config);
  const walked = segments.reduce<Procedure<unknown>>(
    (acc, segment) => reduceConfigPath(acc, { segment, dotted }),
    seed,
  );
  if (!isOk(walked)) return walked;
  if (typeof walked.value !== 'string') {
    return fail(ScraperErrorTypes.Generic, `derivedCarry: config.${dotted} non-string`);
  }
  return succeed(walked.value);
}

/** Args bundle for {@link evalDerivedCarry} — respects the 3-param ceiling. */
interface IEvalDerivedArgs {
  readonly derived: IDerivedCarry;
  readonly creds: Readonly<Record<string, unknown>>;
  readonly config: IApiDirectCallConfig;
  readonly carry: Readonly<CarryMut>;
}

/**
 * Resolve one derived-part RefToken against the partial scope.
 * Extracted so {@link evalDerivedCarry}'s loop body stays at depth-1.
 * @param part - Part RefToken.
 * @param ctx - Eval bundle (provides creds/config/carry).
 * @returns Procedure with the resolved string.
 */
function evalOnePart(part: RefToken, ctx: IEvalDerivedArgs): Procedure<string> {
  return resolveDerivedPart({ part, creds: ctx.creds, config: ctx.config, carry: ctx.carry });
}

/** Bundle for {@link reduceDerivedPart} — one part RefToken + eval context. */
interface IReduceDerivedPartCtx {
  readonly part: RefToken;
  readonly evalCtx: IEvalDerivedArgs;
}

/**
 * Reducer step for the derived-parts loop — resolves one part,
 * appends to the accumulator on success, short-circuits on failure.
 * @param acc - Accumulator (parts collected so far).
 * @param ctx - Bundle with the part RefToken + eval context.
 * @returns Updated parts procedure.
 */
function reduceDerivedPart(
  acc: Procedure<readonly string[]>,
  ctx: IReduceDerivedPartCtx,
): Procedure<readonly string[]> {
  if (!isOk(acc)) return acc;
  const proc = evalOnePart(ctx.part, ctx.evalCtx);
  if (!isOk(proc)) return proc;
  return succeed([...acc.value, proc.value]);
}

/**
 * Evaluate one {@link IDerivedCarry} entry: resolve each part, join
 * with the configured separator, truncate to `truncateBytes` (when
 * set), and return the resulting string.
 * @param args - Evaluation bundle.
 * @returns Procedure with the derived string.
 */
function evalDerivedCarry(args: IEvalDerivedArgs): Procedure<string> {
  const seed: Procedure<readonly string[]> = succeed([]);
  const collected = args.derived.parts.reduce<Procedure<readonly string[]>>(
    (acc, part) => reduceDerivedPart(acc, { part, evalCtx: args }),
    seed,
  );
  if (!isOk(collected)) return collected;
  const joined = collected.value.join(args.derived.separator ?? '');
  if (args.derived.truncateBytes === undefined) return succeed(joined);
  const truncated = joined.slice(0, args.derived.truncateBytes);
  return succeed(truncated);
}

/**
 * Apply one derivedCarry entry to the carry accumulator. Extracted
 * so {@link applyDerivedCarry}'s loop body stays at depth-1.
 * @param derived - Single derivation spec.
 * @param ctx - Eval bundle (config + creds + carry).
 * @returns Procedure with the mutated carry.
 */
function applyOneDerivation(derived: IDerivedCarry, ctx: IEvalDerivedArgs): Procedure<CarryMut> {
  const proc = evalDerivedCarry({ ...ctx, derived });
  if (!isOk(proc)) return proc;
  const carry = ctx.carry as CarryMut;
  carry[derived.into] = proc.value;
  return succeed(carry);
}

/** Bundle for {@link reduceDerivation} — one derivation + eval context. */
interface IReduceDerivationCtx {
  readonly derived: IDerivedCarry;
  readonly evalCtx: IEvalDerivedArgs;
}

/**
 * Reducer step for the derivedCarry loop — applies one derivation
 * entry to the carry accumulator (or short-circuits on failure).
 * @param acc - Accumulator procedure.
 * @param ctx - Bundle with the derivation entry + eval context.
 * @returns Updated accumulator procedure.
 */
function reduceDerivation(
  acc: Procedure<CarryMut>,
  ctx: IReduceDerivationCtx,
): Procedure<CarryMut> {
  if (!isOk(acc)) return acc;
  return applyOneDerivation(ctx.derived, ctx.evalCtx);
}

/**
 * Apply every `derivedCarry` entry in order, writing each result to
 * the carry accumulator. Order matters — later entries may reference
 * earlier ones via `carry.<slot>`.
 * @param config - API-direct-call config.
 * @param creds - Caller credentials.
 * @param carry - Mutable carry accumulator.
 * @returns Procedure with the mutated carry.
 */
function applyDerivedCarry(
  config: IApiDirectCallConfig,
  creds: Readonly<Record<string, unknown>>,
  carry: CarryMut,
): Procedure<CarryMut> {
  const entries = config.derivedCarry ?? [];
  const seed: Procedure<CarryMut> = succeed(carry);
  return entries.reduce<Procedure<CarryMut>>((acc, derived): Procedure<CarryMut> => {
    const evalCtx: IEvalDerivedArgs = { derived, creds, config, carry };
    return reduceDerivation(acc, { derived, evalCtx });
  }, seed);
}

/**
 * Run `seedCarryFromCreds` + `derivedCarry` against the initial carry
 * accumulator. Banks declare both fields on `IApiDirectCallConfig`;
 * banks that omit them get an identity pass-through.
 * @param config - API-direct-call config.
 * @param creds - Caller credentials.
 * @param initialCarry - Carry seeded by the caller (e.g. flowId, warm-start).
 * @returns Procedure with the full initial carry.
 */
function buildInitialCarry(
  config: IApiDirectCallConfig,
  creds: Readonly<Record<string, unknown>>,
  initialCarry: Readonly<Record<string, JsonValue>>,
): Procedure<Readonly<Record<string, JsonValue>>> {
  const carry: CarryMut = { ...initialCarry };
  const seedProc = applySeedCarry(config, creds, carry);
  if (!isOk(seedProc)) return seedProc;
  const derivedProc = applyDerivedCarry(config, creds, seedProc.value);
  if (!isOk(derivedProc)) return derivedProc;
  return succeed(derivedProc.value);
}

export default buildInitialCarry;
export { buildInitialCarry };
