/**
 * Pre-step hook helpers: resolve the creds callback named by a step's
 * `preHook`, acquire its value (reusing this flow's prior acquisition by
 * default) and deposit the result into `carry[hook.intoCarryField]` for the
 * next step's body template.
 *
 * <p>Acquisition lives in `SmsOtpFlow.prehookCache.ts`; invocation and
 * coercion live in `SmsOtpFlow.prehookInvoke.ts`. This module only wires
 * resolution → acquisition → carry deposit. The callback receives the hook's
 * `hintFrom` carry text as its one argument.
 */

import { ScraperErrorTypes } from '../../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../../Types/Procedure.js';
import { currentAbortSignal } from '../../../../Types/RunScope.js';
import DEFAULT_OTP_TIMEOUT_MS from '../../../Timing/OtpTimingConfig.js';
import { RACE_TIMED_OUT, raceTimeout } from '../../../Timing/TimingActions.js';
import type { IPreStepHook } from '../../ConfigContracts/EnvelopeTypes.js';
import type { ITemplateScope } from '../../Template/RefResolver.js';
import { acquirePreHookValue } from './SmsOtpFlow.prehookCache.js';
import type { IApplyPreHookArgs } from './SmsOtpFlow.types.js';

/** A creds callback awaited by a pre-hook; takes the hint. */
type PreHookRetriever = (hint: string) => Promise<unknown>;

const CARRY_PREFIX = 'carry.';
const OTP_TIMEOUT_MESSAGE = 'OTP timeout — code not received';
const RACE_ABORTED = Symbol('RACE_ABORTED');

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
 * Resolves a positive, finite OTP wait budget.
 * @param creds - Credentials and scraper options for this flow.
 * @returns The configured deadline or the standard OTP deadline.
 */
function otpBudget(creds: Readonly<Record<string, unknown>>): Procedure<number> {
  const ms = creds.otpTimeoutMs;
  if (ms === undefined) return succeed(DEFAULT_OTP_TIMEOUT_MS);
  if (typeof ms === 'number' && Number.isFinite(ms) && ms > 0) return succeed(ms);
  return fail(ScraperErrorTypes.Generic, 'preHook: otpTimeoutMs invalid');
}

/**
 * Build the listener that resolves the abort race.
 * @param resolve - The race promise's resolve function.
 * @returns The abort listener.
 */
function abortListener(resolve: (value: typeof RACE_ABORTED) => unknown): () => boolean {
  return (): boolean => {
    resolve(RACE_ABORTED);
    return true;
  };
}

/**
 * Build the rejection that fires when the run aborts.
 * @returns The pending rejection, or false outside a cancellation run.
 */
function runAbortWait(): Promise<typeof RACE_ABORTED> | false {
  const signal = currentAbortSignal();
  if (signal === false) return false;
  return new Promise<typeof RACE_ABORTED>(resolve => {
    const abort = abortListener(resolve);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

/**
 * Convert a settled OTP race into a Procedure.
 * @param result - The acquired value or a race sentinel.
 * @returns The acquired value or the matching timeout failure.
 */
function budgetResult(result: Procedure<string> | symbol): Procedure<string> {
  if (result === RACE_ABORTED) return fail(ScraperErrorTypes.Timeout, 'scrape aborted');
  if (result === RACE_TIMED_OUT) return fail(ScraperErrorTypes.Timeout, OTP_TIMEOUT_MESSAGE);
  return result as Procedure<string>;
}

/**
 * Race the OTP acquisition against its budget and the run signal.
 * @param budgetMs - OTP wait budget.
 * @param acquired - The pending acquisition.
 * @returns The acquired value or a race sentinel.
 */
async function raceBudget(
  budgetMs: number,
  acquired: Promise<Procedure<string>>,
): Promise<Procedure<string> | symbol> {
  const timeout = raceTimeout(budgetMs, acquired);
  const abort = runAbortWait();
  return Promise.race(abort === false ? [timeout] : [timeout, abort]);
}

/**
 * Bounds callback acquisition even when the caller's retriever never settles.
 * @param args - Scope, credentials, hook and flow-scoped cache.
 * @returns The acquired value or a timeout failure.
 */
async function acquireWithinBudget(args: IApplyPreHookArgs): Promise<Procedure<string>> {
  const fnProc = hintedRetriever(args);
  if (!isOk(fnProc)) return fnProc;
  const budget = otpBudget(args.creds);
  if (!isOk(budget)) return budget;
  const acquired = acquirePreHookValue({ cache: args.cache, hook: args.hook, fn: fnProc.value });
  const result = await raceBudget(budget.value, acquired);
  return budgetResult(result);
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
  const valueProc = await acquireWithinBudget(args);
  if (!isOk(valueProc)) return valueProc;
  const nextCarry = { ...args.scope.carry, [args.hook.intoCarryField]: valueProc.value };
  return succeed({ ...args.scope, carry: nextCarry });
}

export { applyPreHook };

// Re-export for parity with the original surface (used by an internal test).
export { default as invokePreHookFn } from './SmsOtpFlow.prehookInvoke.js';
