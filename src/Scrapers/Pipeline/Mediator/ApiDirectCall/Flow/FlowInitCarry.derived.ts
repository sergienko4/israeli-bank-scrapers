/**
 * derivedCarry evaluation: per-part collection, join, the N60 lower-case
 * transform, UTF-8 truncate, the N45 op last,
 * the `applyDerivations` reducer and the flow-init `applyDerivedCarry`.
 * Steps reuse `applyDerivations` for their own `deriveCarry` (N7), naming
 * themselves as the `owner` an op failure names.
 */

import type { Procedure } from '../../../Types/Procedure.js';
import { isOk, succeed } from '../../../Types/Procedure.js';
import type { IApiDirectCallConfig, IDerivedCarry, RefToken } from '../ConfigContracts/index.js';
import { applyDerivedOp } from './FlowInitCarry.ops.js';
import { resolveDerivedPart } from './FlowInitCarry.parts.js';
import type {
  CarryMut,
  Creds,
  IDerivationSharedCtx,
  IEvalDerivedArgs,
  IReduceDerivationCtx,
  IReduceDerivedPartCtx,
} from './FlowInitCarry.types.js';

/** What an op failure names when no step owns the derivation. */
const FLOW_INIT_OWNER = 'derivedCarry:';

/**
 * Resolve one derived-part RefToken against the partial scope.
 * @param part - Part RefToken.
 * @param ctx - Eval bundle (provides creds/config/carry).
 * @returns Procedure with the resolved string.
 */
function evalOnePart(part: RefToken, ctx: IEvalDerivedArgs): Procedure<string> {
  return resolveDerivedPart({ part, creds: ctx.creds, config: ctx.config, carry: ctx.carry });
}

/**
 * Reducer step for the derived-parts loop.
 * @param acc - Accumulator procedure (parts collected so far).
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
 * Truncate `value` to at most `maxBytes` UTF-8 bytes, never splitting
 * a multi-byte codepoint.
 * @param value - Joined source string.
 * @param maxBytes - Upper bound in UTF-8 bytes.
 * @returns Truncated string whose UTF-8 byte length is ≤ maxBytes.
 */
function truncateUtf8(value: string, maxBytes: number): string {
  const encoded = Buffer.from(value, 'utf8');
  if (encoded.length <= maxBytes) return value;
  let end = Math.floor(maxBytes);
  while ((encoded[end] & 0xc0) === 0x80) end -= 1;
  const slice = encoded.subarray(0, end);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  return decoder.decode(slice);
}

/**
 * Join collected parts with the configured separator, lower-case the text
 * when the spec asks (before the cap, so a char that grows still fits), and
 * optionally truncate to a UTF-8 byte cap.
 * @param parts - Collected string parts.
 * @param derived - Derived-carry spec (separator, transform, truncateBytes).
 * @returns Assembled string.
 */
function joinAndTruncate(parts: readonly string[], derived: IDerivedCarry): string {
  const joined = parts.join(derived.separator ?? '');
  const shaped = derived.transform === 'lower' ? joined.toLowerCase() : joined;
  if (derived.truncateBytes === undefined) return shaped;
  return truncateUtf8(shaped, derived.truncateBytes);
}

/**
 * Resolve every part of a derivedCarry spec, in order.
 * @param args - Derived-carry evaluation bundle.
 * @returns Procedure with the parts, or the first part that failed.
 */
function collectParts(args: IEvalDerivedArgs): Procedure<readonly string[]> {
  const seed: Procedure<readonly string[]> = succeed([]);
  return args.derived.parts.reduce<Procedure<readonly string[]>>(
    (acc, part) => reduceDerivedPart(acc, { part, evalCtx: args }),
    seed,
  );
}

/**
 * Evaluate a single derivedCarry spec end-to-end.
 * @param args - Derived-carry evaluation bundle.
 * @returns Procedure with the assembled string, or the part or op failure.
 */
function evalDerivedCarry(args: IEvalDerivedArgs): Procedure<string> {
  const collected = collectParts(args);
  if (!isOk(collected)) return collected;
  const text = joinAndTruncate(collected.value, args.derived);
  const subject = `${args.owner} ${args.derived.into}`;
  return applyDerivedOp({ text, subject, op: args.derived.op });
}

/**
 * Apply one derivedCarry entry to the carry accumulator.
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

/**
 * Reducer step for the derivedCarry loop.
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
 * Build the reducer context for one derivation entry.
 * @param derived - Single derivation spec.
 * @param shared - Eval-context shared across entries.
 * @returns Reduce-context bundle.
 */
function buildDerivationCtx(
  derived: IDerivedCarry,
  shared: IDerivationSharedCtx,
): IReduceDerivationCtx {
  const { creds, config, carry } = shared;
  const owner = shared.owner ?? FLOW_INIT_OWNER;
  const evalCtx: IEvalDerivedArgs = { derived, creds, config, carry, owner };
  return { derived, evalCtx };
}

/**
 * Args bundle for `applyDerivedCarry` — keeps the signature single-line.
 * `owner` prefixes an op failure: a step passes `<step> derive`; flow
 * init leaves it unset (`derivedCarry:`).
 */
interface IApplyDerivedCarryArgs {
  readonly config: IApiDirectCallConfig;
  readonly creds: Creds;
  readonly carry: CarryMut;
  readonly owner?: string;
}

/**
 * Apply derivation entries in order, each over the carry the earlier ones
 * filled.
 * @param entries - Derivation specs.
 * @param args - Config + creds + carry bundle; the carry is filled in place.
 * @returns Procedure with the filled carry, or the first part that failed.
 */
function applyDerivations(
  entries: readonly IDerivedCarry[],
  args: IApplyDerivedCarryArgs,
): Procedure<CarryMut> {
  const seed: Procedure<CarryMut> = succeed(args.carry);
  return entries.reduce<Procedure<CarryMut>>((acc, derived) => {
    const ctx = buildDerivationCtx(derived, args);
    return reduceDerivation(acc, ctx);
  }, seed);
}

/**
 * Apply every flow-init `derivedCarry` entry of the bank config in order.
 * @param args - Config + creds + carry bundle.
 * @returns Procedure with the mutated carry.
 */
function applyDerivedCarry(args: IApplyDerivedCarryArgs): Procedure<CarryMut> {
  const entries = args.config.derivedCarry ?? [];
  return applyDerivations(entries, args);
}

export { applyDerivations, applyDerivedCarry };
export type { IApplyDerivedCarryArgs };
