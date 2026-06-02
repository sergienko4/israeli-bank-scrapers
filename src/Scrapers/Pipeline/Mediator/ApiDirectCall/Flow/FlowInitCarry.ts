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
 * Standard failure for missing/empty source on sha256-prefix-16.
 * @param from - Creds field name.
 * @returns Procedure failure.
 */
function sha256MissingFail(from: string): Procedure<string> {
  return fail(
    ScraperErrorTypes.Generic,
    `sha256-prefix-16 bootstrap: creds.${from} missing or empty`,
  );
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
  if (typeof raw !== 'string' || raw.length === 0) return sha256MissingFail(from);
  const digest = createHash('sha256').update(raw, 'utf8').digest('hex');
  const prefix = digest.slice(0, SHA256_PREFIX_LENGTH);
  return succeed(prefix);
}

/** Index of the JWT payload segment (between header and signature). */
const JWT_PAYLOAD_SEGMENT_INDEX = 1;

/** Walk context for {@link stepJsonPath}. */
interface IWalkJsonCtx {
  readonly path: string;
}

/**
 * Step the json-path walker one segment forward.
 * @param acc - Current cursor procedure.
 * @param segment - Next path segment.
 * @param ctx - Walk context (carries the full dotted path).
 * @returns Updated cursor procedure.
 */
function stepJsonPath(
  acc: Procedure<unknown>,
  segment: string,
  ctx: IWalkJsonCtx,
): Procedure<unknown> {
  if (!isOk(acc)) return acc;
  const cursor = acc.value;
  if (cursor === null || typeof cursor !== 'object') {
    return fail(ScraperErrorTypes.Generic, `jwt-claim: path '${ctx.path}' miss at '${segment}'`);
  }
  const child = (cursor as Record<string, unknown>)[segment];
  return succeed(child);
}

/**
 * Coerce the final walker cursor to a string Procedure.
 * @param walked - Walker outcome.
 * @param path - Dotted path (for diagnostics).
 * @returns Procedure with the string value.
 */
function coerceWalkedString(walked: Procedure<unknown>, path: string): Procedure<string> {
  if (!isOk(walked)) return walked;
  if (typeof walked.value !== 'string') {
    return fail(ScraperErrorTypes.Generic, `jwt-claim: path '${path}' non-string`);
  }
  return succeed(walked.value);
}

/**
 * Walk a dotted path through a record-of-records, returning the leaf
 * string value when found. Used by `bootstrapJwtClaim` to navigate
 * the decoded JWT payload.
 * @param root - Decoded JWT payload (untyped JSON).
 * @param path - Dotted path (e.g. `pl.uId`).
 * @returns Procedure with the leaf string.
 */
function walkJsonPath(root: unknown, path: string): Procedure<string> {
  const segments = path.split('.');
  const seed: Procedure<unknown> = succeed(root);
  const ctx: IWalkJsonCtx = { path };
  const walked = segments.reduce<Procedure<unknown>>(
    (acc, seg) => stepJsonPath(acc, seg, ctx),
    seed,
  );
  return coerceWalkedString(walked, path);
}

/**
 * Decode + parse one base64url JWT segment (the inner try/catch).
 * @param payloadB64 - Raw base64url-encoded JWT payload segment.
 * @returns Procedure with the parsed value or fail.
 */
function tryParseJwtSegment(payloadB64: string): Procedure<unknown> {
  try {
    const decoded = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded) as unknown;
    return succeed(parsed);
  } catch (error) {
    const reason = (error as Error).message;
    return fail(ScraperErrorTypes.Generic, `jwt-claim: payload decode failed: ${reason}`);
  }
}

/**
 * Decode a JWT payload from base64url and parse it as JSON. Returns a
 * structured failure when the input does not have three segments or
 * the payload is not valid JSON.
 * @param jwt - JWT string (three base64url-encoded segments).
 * @returns Procedure with the parsed payload.
 */
function decodeJwtPayload(jwt: string): Procedure<unknown> {
  const segments = jwt.split('.');
  if (segments.length !== 3) {
    return fail(ScraperErrorTypes.Generic, 'jwt-claim: JWT must have 3 segments');
  }
  const payloadB64 = segments[JWT_PAYLOAD_SEGMENT_INDEX];
  return tryParseJwtSegment(payloadB64);
}

/**
 * Extract a string-valued claim from the JWT carried in another creds
 * field. Used for warm-start carry seeding when the bank's post-login
 * API embeds a user-identifier claim (e.g. PayBox's `pl.uId`) that
 * would otherwise only reach carry via the skipped login extraction.
 * @param from - Creds field carrying the JWT.
 * @param claim - Dotted path into the decoded payload.
 * @param creds - Caller credentials.
 * @returns Procedure with the extracted claim value.
 */
/** Args bundle for {@link bootstrapJwtClaim} — preserves the 3-param ceiling. */
interface IJwtClaimArgs {
  readonly from: string;
  readonly claim: string;
  readonly optional: boolean;
  readonly creds: Readonly<Record<string, unknown>>;
}

/**
 * Surface a missing/empty source — strict mode fails fast, optional
 * mode returns an empty seed so the carry slot stays available for a
 * later step's `extractsToCarry` to fill (cold-path JWT bootstrap).
 * @param args - Args bundle.
 * @returns Procedure with empty string (optional) or fail (strict).
 */
function emptySourceOutcome(args: IJwtClaimArgs): Procedure<string> {
  if (args.optional) return succeed('');
  const reason = `jwt-claim bootstrap: creds.${args.from} missing or empty`;
  return fail(ScraperErrorTypes.Generic, reason);
}

/**
 * Decode the JWT in `creds[args.from]` and walk to `args.claim`.
 * Returns an empty string when the source is missing/empty AND the
 * config marked the bootstrap `optional: true` — see
 * {@link emptySourceOutcome} for the rationale.
 * @param args - Bootstrap args bundle.
 * @returns Procedure with the leaf string.
 */
function bootstrapJwtClaim(args: IJwtClaimArgs): Procedure<string> {
  const raw = args.creds[args.from];
  if (typeof raw !== 'string' || raw.length === 0) return emptySourceOutcome(args);
  const decoded = decodeJwtPayload(raw);
  if (!isOk(decoded)) return decoded;
  return walkJsonPath(decoded.value, args.claim);
}

/**
 * Build the bootstrapJwtClaim args bundle from a discriminated
 * jwt-claim bootstrap descriptor.
 * @param bootstrap - Discriminated jwt-claim bootstrap.
 * @param creds - Caller credentials.
 * @returns IJwtClaimArgs bundle.
 */
function makeJwtClaimArgs(
  bootstrap: Extract<SeedCarryBootstrapKind, { kind: 'jwt-claim' }>,
  creds: Readonly<Record<string, unknown>>,
): IJwtClaimArgs {
  return {
    from: bootstrap.from,
    claim: bootstrap.claim,
    optional: bootstrap.optional === true,
    creds,
  };
}

/**
 * Dispatch a bootstrap kind to its generator. Extracted so the
 * outer {@link evalSeedSource} stays inside the per-function depth
 * budget when a new kind is added.
 *
 * <p>Phase 8.5c / Commit T2 — `SeedCarryBootstrapKind` is now a
 * uniform `{ kind, … }` union (PR #279 CR F2 closure), so the
 * dispatch falls through an exhaustive `kind` check terminated
 * by {@link assertNever}. Adding a new bootstrap kind to the
 * union causes a TypeScript error on the `assertNever` call,
 * forcing the author to add a matching case.</p>
 *
 * @param bootstrap - Discriminated bootstrap descriptor.
 * @param creds - Caller credentials (consulted by parameterised kinds).
 * @returns Procedure with the bootstrap-produced value.
 */
function evalBootstrap(
  bootstrap: SeedCarryBootstrapKind,
  creds: Readonly<Record<string, unknown>>,
): Procedure<string> {
  if (bootstrap.kind === 'random-hex-16') return bootstrapRandomHex16();
  if (bootstrap.kind === 'sha256-prefix-16') {
    return bootstrapSha256Prefix16(bootstrap.from, creds);
  }
  const args = makeJwtClaimArgs(bootstrap, creds);
  return bootstrapJwtClaim(args);
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
  if (entry.bootstrap === undefined) return noBootstrapFail(entry.field);
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
 * Resolve a `carry.<slot>` derived part.
 * @param rest - Slot name after the `carry.` prefix.
 * @param args - Resolver args bundle.
 * @returns Procedure with the string value.
 */
function resolveCarryPart(rest: string, args: IResolveDerivedPartArgs): Procedure<string> {
  return carryString(rest, args.carry);
}

/**
 * Resolve a `creds.<field>` derived part.
 * @param rest - Creds field after the `creds.` prefix.
 * @param args - Resolver args bundle.
 * @returns Procedure with the string value.
 */
function resolveCredsPart(rest: string, args: IResolveDerivedPartArgs): Procedure<string> {
  return credsString(rest, args.creds);
}

/**
 * Resolve a `config.<path>` derived part.
 * @param rest - Dotted path after the `config.` prefix.
 * @param args - Resolver args bundle.
 * @returns Procedure with the string value.
 */
function resolveConfigPart(rest: string, args: IResolveDerivedPartArgs): Procedure<string> {
  return configString(rest, args.config);
}

/** Single prefix→resolver rule for the derived-part dispatch. */
interface IPartRule {
  readonly prefix: string;
  readonly resolve: (rest: string, args: IResolveDerivedPartArgs) => Procedure<string>;
}

/** Dispatch table mapping RefToken prefixes to their resolvers. */
const PART_RULES: readonly IPartRule[] = [
  { prefix: 'carry.', resolve: resolveCarryPart },
  { prefix: 'creds.', resolve: resolveCredsPart },
  { prefix: 'config.', resolve: resolveConfigPart },
];

/**
 * Resolve a single {@link IDerivedCarry} part — RefToken targeting
 * `carry.<slot>`, `creds.<field>`, or `config.<dotted.path>`.
 * @param args - Bundle (part + creds + config + carry).
 * @returns Procedure with the part value as string.
 */
function resolveDerivedPart(args: IResolveDerivedPartArgs): Procedure<string> {
  const part = args.part;
  const rule = PART_RULES.find(candidate => part.startsWith(candidate.prefix));
  if (rule === undefined) {
    return fail(ScraperErrorTypes.Generic, `derivedCarry part not supported: ${part as string}`);
  }
  const rest = part.slice(rule.prefix.length);
  return rule.resolve(rest, args);
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
 * Coerce a config-walker outcome to a string Procedure.
 * @param walked - Walker outcome.
 * @param dotted - Original dotted path (for diagnostics).
 * @returns Procedure with the string value.
 */
function coerceConfigWalked(walked: Procedure<unknown>, dotted: string): Procedure<string> {
  if (!isOk(walked)) return walked;
  if (typeof walked.value !== 'string') {
    return fail(ScraperErrorTypes.Generic, `derivedCarry: config.${dotted} non-string`);
  }
  return succeed(walked.value);
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
  return coerceConfigWalked(walked, dotted);
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
/**
 * Truncate `value` to at most `maxBytes` UTF-8 bytes, never splitting
 * a multi-byte codepoint. ASCII inputs (the only current consumer
 * shape — hex IDs, JWTs, phone digits) hit the fast path; non-ASCII
 * inputs decode back from the byte-truncated buffer with the
 * `fatal: false` policy that drops a trailing incomplete codepoint.
 * @param value - Joined source string.
 * @param maxBytes - Upper bound in UTF-8 bytes.
 * @returns Truncated string whose UTF-8 byte length is ≤ maxBytes.
 */
function truncateUtf8(value: string, maxBytes: number): string {
  const encoded = Buffer.from(value, 'utf8');
  if (encoded.length <= maxBytes) return value;
  const slice = encoded.subarray(0, maxBytes);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  return decoder.decode(slice);
}

/**
 * Join collected parts with the configured separator and optionally
 * truncate to a UTF-8 byte cap.
 * @param parts - Collected string parts.
 * @param derived - Derived-carry spec (separator + truncateBytes).
 * @returns Assembled string.
 */
function joinAndTruncate(parts: readonly string[], derived: IDerivedCarry): string {
  const joined = parts.join(derived.separator ?? '');
  if (derived.truncateBytes === undefined) return joined;
  return truncateUtf8(joined, derived.truncateBytes);
}

/**
 * Evaluate a single derivedCarry spec end-to-end — collect its
 * `parts`, join via the configured separator, optionally truncate
 * to a UTF-8 byte cap, and surface the result as a Procedure.
 * @param args - Derived-carry evaluation bundle.
 * @returns Procedure with the assembled string, or fail.
 */
function evalDerivedCarry(args: IEvalDerivedArgs): Procedure<string> {
  const seed: Procedure<readonly string[]> = succeed([]);
  const collected = args.derived.parts.reduce<Procedure<readonly string[]>>(
    (acc, part) => reduceDerivedPart(acc, { part, evalCtx: args }),
    seed,
  );
  if (!isOk(collected)) return collected;
  const value = joinAndTruncate(collected.value, args.derived);
  return succeed(value);
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
