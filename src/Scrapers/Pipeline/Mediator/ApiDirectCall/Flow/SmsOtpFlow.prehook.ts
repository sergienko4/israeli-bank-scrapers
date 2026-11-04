/**
 * Pre-step hook helpers: resolve the creds callback named by a step's
 * `preHook`, acquire its value (reusing this flow's prior acquisition by
 * default) and deposit the result into `carry[hook.intoCarryField]` for the
 * next step's body template.
 *
 * <p>Acquisition lives in `SmsOtpFlow.prehookCache.ts`; invocation and
 * coercion live in `SmsOtpFlow.prehookInvoke.ts`. This module only wires
 * resolution → acquisition → carry deposit. The callback receives the hook's
 * `hintFrom` carry text as its one argument (N15).
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { IPreStepHook } from '../ConfigContracts/EnvelopeTypes.js';
import type { ITemplateScope } from '../Template/RefResolver.js';
import { acquirePreHookValue } from './SmsOtpFlow.prehookCache.js';
import type { IApplyPreHookArgs } from './SmsOtpFlow.types.js';

/** A creds callback awaited by a pre-hook; takes the hint. */
type PreHookRetriever = (hint: string) => Promise<unknown>;

const CARRY_PREFIX = 'carry.';

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
function missingFnFail(hook: IPreStepHook): Procedure<PreHookRetriever> {
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
): Procedure<PreHookRetriever> {
  const fn = creds[hook.awaitCredsField];
  if (typeof fn !== 'function') return missingFnFail(hook);
  return succeed(fn as PreHookRetriever);
}

/**
 * The hint the callback receives: the `hintFrom` carry slot's text, or `''`
 * when the hook names none or the slot is absent or not text.
 * @param hook - Pre-step hook config.
 * @param scope - Current scope.
 * @returns The hint.
 */
function preHookHint(hook: IPreStepHook, scope: ITemplateScope): string {
  if (hook.hintFrom === undefined) return '';
  const slot = hook.hintFrom.slice(CARRY_PREFIX.length);
  const hint = scope.carry[slot];
  return typeof hint === 'string' ? hint : '';
}

/**
 * Resolve the hook's callback and bind its hint.
 * @param args - Scope + creds + hook + flow-cache bundle.
 * @returns Procedure with the argument-free callback.
 */
function hintedRetriever(args: IApplyPreHookArgs): Procedure<() => Promise<unknown>> {
  const fnProc = resolvePreHookFn(args.creds, args.hook);
  if (!isOk(fnProc)) return fnProc;
  const hint = preHookHint(args.hook, args.scope);
  const fn = fnProc.value.bind(undefined, hint);
  return succeed(fn);
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
  const fnProc = hintedRetriever(args);
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
