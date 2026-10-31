/**
 * Pre-hook guards (N21) that bracket a step's credential acquisition.
 *
 * <p>Before: each `requires` ref must resolve. Refs resolve against the
 * step's jar view, bound to the step URL as `runStep` binds it, so a
 * `cookie.<name>` ref reads what the step's request would send. A miss reports
 * the resolver's own failure (`ref <token> miss` / `bad`) and the callback is
 * never asked, so no code is spent on a login that cannot finish.
 *
 * <p>After: the deposited value must match the hook's anchored
 * `valuePattern`, else the step fails InvalidOtp before its request. Neither
 * guard puts a value in its failure text.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import { resolveWkUrl } from '../../../Registry/WK/UrlsWK.js';
import type { IProcedureFailure, Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { JsonValue } from '../Envelope/JsonPointer.js';
import { type ITemplateScope, resolveRef } from '../Template/RefResolver.js';
import { applyPreHook } from './SmsOtpFlow.prehook.js';
import type { IPreHookGuardArgs } from './SmsOtpFlow.types.js';

/**
 * The scope with the step's jar view bound to its URL, when the run has a jar.
 * @param args - Guard bundle.
 * @returns The bound scope, the scope unchanged without a jar, or a failure.
 */
function stepJarScope(args: IPreHookGuardArgs): Procedure<ITemplateScope> {
  const jar = args.reduce.bus.cookies;
  if (jar === undefined) return succeed(args.scope);
  const url = resolveWkUrl(args.step.urlTag, args.reduce.companyId);
  if (!isOk(url)) return url;
  const cookie = jar.cookieFor.bind(null, url.value);
  return succeed({ ...args.scope, cookie });
}

/**
 * Whether a ref failed to resolve.
 * @param proc - Resolved ref.
 * @returns True on failure.
 */
function isMiss(proc: Procedure<JsonValue>): proc is IProcedureFailure {
  return !isOk(proc);
}

/**
 * Resolve the pre-hook's `requires` refs; the first miss fails the step.
 * @param args - Guard bundle.
 * @returns The scope unchanged, or the resolver's failure.
 */
function checkPreHookRequires(args: IPreHookGuardArgs): Procedure<ITemplateScope> {
  const tokens = args.hook.requires ?? [];
  if (tokens.length === 0) return succeed(args.scope);
  const bound = stepJarScope(args);
  if (!isOk(bound)) return bound;
  const resolved = tokens.map((token): Procedure<JsonValue> => resolveRef(token, bound.value));
  const miss = resolved.find(isMiss);
  return miss ?? succeed(args.scope);
}

/**
 * Check the deposited pre-hook value against the hook's `valuePattern`.
 * @param args - Guard bundle.
 * @param scope - Scope after the pre-hook deposited its value.
 * @returns The scope unchanged, or an InvalidOtp failure naming no value.
 */
function checkPreHookValue(
  args: IPreHookGuardArgs,
  scope: ITemplateScope,
): Procedure<ITemplateScope> {
  if (args.hook.valuePattern === undefined) return succeed(scope);
  const pattern = new RegExp(args.hook.valuePattern, 'u');
  const value = scope.carry[args.hook.intoCarryField];
  if (typeof value === 'string' && pattern.test(value)) return succeed(scope);
  return fail(ScraperErrorTypes.InvalidOtp, `${args.step.name} preHook value invalid`);
}

/**
 * Run the step's pre-hook between its `requires` and `valuePattern` guards.
 * @param args - Guard bundle.
 * @returns Scope carrying the deposited value, or the first guard/hook failure.
 */
async function applyGuardedPreHook(args: IPreHookGuardArgs): Promise<Procedure<ITemplateScope>> {
  const ready = checkPreHookRequires(args);
  if (!isOk(ready)) return ready;
  const { scope, hook } = args;
  const hookArgs = { scope, creds: args.reduce.creds, hook, cache: args.reduce.preHookCache };
  const hooked = await applyPreHook(hookArgs);
  if (!isOk(hooked)) return hooked;
  return checkPreHookValue(args, hooked.value);
}

export default applyGuardedPreHook;
export { applyGuardedPreHook };
