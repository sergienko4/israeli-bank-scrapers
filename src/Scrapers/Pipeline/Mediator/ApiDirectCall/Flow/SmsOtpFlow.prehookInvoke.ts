/**
 * Pre-step hook invocation — call the creds callback and coerce its result.
 *
 * <p>Split from `SmsOtpFlow.prehook.ts` so the reuse cache can sit between the
 * invoker and `applyPreHook` without forming an import cycle:
 * `prehook → prehookCache → prehookInvoke`.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import { errorNameOf } from '../../../Types/ErrorUtils.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';
import type { IPreStepHook } from '../ConfigContracts/EnvelopeTypes.js';
import type { JsonValue } from '../Envelope/JsonPointer.js';
import type { IInvokePreHookArgs, IPreHookCoerceArgs } from './SmsOtpFlow.types.js';

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
 *
 * <p>Names the error, never its message: a caller's error text may
 * repeat the code, the phone or a token it was handed.
 *
 * <p>Adds the invocation ordinal only from the second invocation onward. A
 * failure on invocation #2 of the same login points at a caller whose
 * credential source is single-shot — a very different fault from a
 * first-invocation failure. On invocation #1 the ordinal carries no
 * information, so single-hook flows get the plain message.
 * @param hook - Pre-step hook config.
 * @param errorName - Name of the thrown error.
 * @param invocation - 1-based ordinal of this invocation within the flow.
 * @returns Procedure failure.
 */
function preHookThrowFail(
  hook: IPreStepHook,
  errorName: string,
  invocation: number,
): Procedure<string> {
  const field = `creds.${hook.awaitCredsField}()`;
  const at = invocation > 1 ? ` on invocation #${String(invocation)} of this login` : '';
  return fail(ScraperErrorTypes.Generic, `preHook: ${field} threw ${errorName}${at}`);
}

/**
 * Invoke the creds callback and coerce the result to a string.
 * @param args - Bound creds fn + hook config + invocation ordinal.
 * @returns Procedure with the string result or a fail.
 */
async function invokePreHookFn(args: IInvokePreHookArgs): Promise<Procedure<string>> {
  try {
    const raw = (await args.fn()) as JsonValue;
    return coercePreHookResult({ raw, hook: args.hook });
  } catch (error) {
    const errorName = errorNameOf(error);
    return preHookThrowFail(args.hook, errorName, args.invocation);
  }
}

export default invokePreHookFn;
