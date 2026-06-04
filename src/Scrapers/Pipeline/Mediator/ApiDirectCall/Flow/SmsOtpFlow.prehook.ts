/**
 * Pre-step hook helpers: invoke a creds callback and deposit the result
 * into carry[hook.intoCarryField] for the next step's body template.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import { toErrorMessage } from '../../../Types/ErrorUtils.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { JsonValue } from '../Envelope/JsonPointer.js';
import type { IPreStepHook } from '../IApiDirectCallConfig.js';
import type { ITemplateScope } from '../Template/RefResolver.js';
import type {
  IApplyPreHookArgs,
  IInvokePreHookArgs,
  IPreHookCoerceArgs,
} from './SmsOtpFlow.types.js';

/**
 * Coerce the pre-hook callback return to a string Procedure.
 * @param args - Raw value + hook bundle.
 * @returns Procedure with the string or a fail.
 */
function coercePreHookResult(args: IPreHookCoerceArgs): Procedure<string> {
  if (typeof args.raw !== 'string') {
    const msg = `preHook: creds.${args.hook.awaitCredsField}() did not return a string`;
    return fail(ScraperErrorTypes.Generic, msg);
  }
  return succeed(args.raw);
}

/**
 * Build the standard preHook-throw failure procedure.
 * @param hook - Pre-step hook config.
 * @param message - Error message text.
 * @returns Procedure failure.
 */
function preHookThrowFail(hook: IPreStepHook, message: string): Procedure<string> {
  const msg = `preHook: creds.${hook.awaitCredsField}() threw: ${message}`;
  return fail(ScraperErrorTypes.Generic, msg);
}

/**
 * Invoke the creds callback and coerce the result to a string.
 * @param args - Bound creds fn + hook config bundle.
 * @returns Procedure with the string result or a fail.
 */
async function invokePreHookFn(args: IInvokePreHookArgs): Promise<Procedure<string>> {
  try {
    const raw = (await args.fn()) as JsonValue;
    return coercePreHookResult({ raw, hook: args.hook });
  } catch (error) {
    const message = toErrorMessage(error);
    return preHookThrowFail(args.hook, message);
  }
}

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

// Re-export for parity with the original surface (used by an internal test).

/**
 * Await the creds function named in preHook and deposit the string
 * result into carry[intoCarryField]. Non-string returns fail.
 * @param args - Scope + creds + hook bundle.
 * @returns Updated scope or fail.
 */
async function applyPreHook(args: IApplyPreHookArgs): Promise<Procedure<ITemplateScope>> {
  const fnProc = resolvePreHookFn(args.creds, args.hook);
  if (!isOk(fnProc)) return fnProc;
  const valueProc = await invokePreHookFn({ fn: fnProc.value, hook: args.hook });
  if (!isOk(valueProc)) return valueProc;
  const nextCarry = { ...args.scope.carry, [args.hook.intoCarryField]: valueProc.value };
  return succeed({ ...args.scope, carry: nextCarry });
}

export { applyPreHook, invokePreHookFn, preHookMissingFnFail };
