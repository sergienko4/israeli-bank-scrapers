/**
 * derivedCarry evaluation: per-part collection, join + UTF-8 truncate,
 * and the top-level `applyDerivedCarry` reducer.
 */

import type { Procedure } from '../../../Types/Procedure.js';
import { isOk, succeed } from '../../../Types/Procedure.js';
import type { IApiDirectCallConfig, IDerivedCarry, RefToken } from '../IApiDirectCallConfig.js';
import { resolveDerivedPart } from './FlowInitCarry.parts.js';
import type {
  CarryMut,
  Creds,
  IDerivationSharedCtx,
  IEvalDerivedArgs,
  IReduceDerivationCtx,
  IReduceDerivedPartCtx,
} from './FlowInitCarry.types.js';

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
 * Evaluate a single derivedCarry spec end-to-end.
 * @param args - Derived-carry evaluation bundle.
 * @returns Procedure with the assembled string.
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
  const evalCtx: IEvalDerivedArgs = { derived, creds, config, carry };
  return { derived, evalCtx };
}

/** Args bundle for `applyDerivedCarry` — keeps the signature single-line. */
interface IApplyDerivedCarryArgs {
  readonly config: IApiDirectCallConfig;
  readonly creds: Creds;
  readonly carry: CarryMut;
}

/**
 * Apply every `derivedCarry` entry in order.
 * @param args - Config + creds + carry bundle.
 * @returns Procedure with the mutated carry.
 */
function applyDerivedCarry(args: IApplyDerivedCarryArgs): Procedure<CarryMut> {
  const { config, creds, carry } = args;
  const entries = config.derivedCarry ?? [];
  const seed: Procedure<CarryMut> = succeed(carry);
  const shared: IDerivationSharedCtx = { creds, config, carry };
  return entries.reduce<Procedure<CarryMut>>((acc, derived) => {
    const ctx = buildDerivationCtx(derived, shared);
    return reduceDerivation(acc, ctx);
  }, seed);
}

export { applyDerivedCarry };
export type { IApplyDerivedCarryArgs };
