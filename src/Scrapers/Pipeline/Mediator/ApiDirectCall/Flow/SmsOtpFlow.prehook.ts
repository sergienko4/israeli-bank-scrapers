/**
 * Pre-step hook helpers: resolve the creds callback named by a step's
 * `preHook`, acquire its value (reusing this flow's prior acquisition by
 * default) and deposit the result into `carry[hook.intoCarryField]` for the
 * next step's body template.
 *
 * <p>Acquisition lives in `SmsOtpFlow.prehookCache.ts`; invocation and
 * coercion live in `SmsOtpFlow.prehookInvoke.ts`. This module only wires
 * resolution → acquisition → carry deposit.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { IPreStepHook } from '../ConfigContracts/EnvelopeTypes.js';
import type { ITemplateScope } from '../Template/RefResolver.js';
import { acquirePreHookValue } from './SmsOtpFlow.prehookCache.js';
import type { IApplyPreHookArgs } from './SmsOtpFlow.types.js';

/**
 * Build the standard preHook missing-function failure procedure.
 * @param hook - Pre-step hook config.
 * @returns Procedure failure.
 */
function preHookMissingFnFail(hook: IPreStepHook): Procedure<ITemplateScope> {
  const msg = `preHook: creds.${hook.awaitCredsField} is not a function`;
  return fail(ScraperErrorTypes.TwoFactorRetrieverMissing, msg);
}

/**
 * Build the missing-fn failure used by the resolver.
 * @param hook - Pre-step hook config.
 * @returns Procedure failure typed for the resolver caller.
 */
function missingFnFail(hook: IPreStepHook): Procedure<() => Promise<unknown>> {
  const msg = `preHook: creds.${hook.awaitCredsField} is not a function`;
  return fail(ScraperErrorTypes.TwoFactorRetrieverMissing, msg);
}

/**
 * Resolve the bound creds callback for this hook, returning a failure
 * when the field is not a function.
 * @param creds - Caller credentials.
 * @param hook - Pre-step hook config.
 * @returns Procedure with the bound callback.
 */
function resolvePreHookFn(
  creds: Readonly<Record<string, unknown>>,
  hook: IPreStepHook,
): Procedure<() => Promise<unknown>> {
  const fn = creds[hook.awaitCredsField];
  if (typeof fn !== 'function') return missingFnFail(hook);
  return succeed(fn as () => Promise<unknown>);
}

/**
 * Acquire the hook's credential and deposit the string result into
 * `carry[intoCarryField]`. Non-string returns fail.
 *
 * <p>Acquisition is flow-scoped by default, so several steps awaiting the same
 * credential share one acquisition rather than asking the caller repeatedly
 * for a secret the bank delivered once.
 * @param args - Scope + creds + hook + flow-cache bundle.
 * @returns Updated scope or fail.
 */
async function applyPreHook(args: IApplyPreHookArgs): Promise<Procedure<ITemplateScope>> {
  const fnProc = resolvePreHookFn(args.creds, args.hook);
  if (!isOk(fnProc)) return fnProc;
  const acquireArgs = { cache: args.cache, hook: args.hook, fn: fnProc.value };
  const valueProc = await acquirePreHookValue(acquireArgs);
  if (!isOk(valueProc)) return valueProc;
  const nextCarry = { ...args.scope.carry, [args.hook.intoCarryField]: valueProc.value };
  return succeed({ ...args.scope, carry: nextCarry });
}

export { applyPreHook, preHookMissingFnFail };

// Re-export for parity with the original surface (used by an internal test).
export { default as invokePreHookFn } from './SmsOtpFlow.prehookInvoke.js';
