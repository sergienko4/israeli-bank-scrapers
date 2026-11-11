/**
 * Pre-hook guards that bracket a step's credential acquisition.
 *
 * <p>Before: the step URL must resolve and each `requires` ref must resolve.
 * Refs resolve against the step's jar view, bound to the step URL as `runStep`
 * binds it, so a `cookie.<name>` ref reads what the step's request would send.
 * A miss reports the resolver's own failure (`ref <token> miss` / `bad`) and
 * the callback is never asked, so no code is spent on a login that cannot finish.
 *
 * <p>Length: a `valueLengthRef` slot the bank set must hold an integer
 * 4..10, else the step fails before the callback is asked; an absent slot
 * leaves `valuePattern` alone.
 *
 * <p>After: the deposited value must match the hook's anchored
 * `valuePattern` and, when a length is stated, be exactly that many ASCII
 * digits, else the step fails InvalidOtp before its request. No guard puts a
 * value in its failure text.
 */

import { ScraperErrorTypes } from '../../../../../Base/ErrorTypes.js';
import { createDomainCookieJar } from '../../../../Strategy/Fetch/DomainCookieJar.js';
import type { IClientCookie, ICookieSession } from '../../../../Types/Domain/CookieSession.js';
import { none, type Option } from '../../../../Types/Option.js';
import type { IProcedureFailure, Procedure } from '../../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../../Types/Procedure.js';
import type { JsonValue } from '../../Envelope/JsonPointer.js';
import { type ITemplateScope, resolveRef } from '../../Template/RefResolver.js';
import { clientCookieOf, cookieRefOf } from '../RunStep.clientCookies.js';
import { stepBaseUrlOf } from '../RunStep.stepUrl.js';
import { applyPreHook } from './SmsOtpFlow.prehook.js';
import type { IPreHookGuardArgs } from './SmsOtpFlow.types.js';

type CookieLookup = NonNullable<ITemplateScope['cookie']>;
type CookieRead = ReturnType<CookieLookup>;

/** Everything needed to preview a step cookie without touching the live jar. */
interface IPendingCookieView {
  readonly args: IPreHookGuardArgs;
  readonly jar: ICookieSession;
  readonly url: string;
}

const CARRY_PREFIX = 'carry.';
/** Decimal text of a stated OTP length. */
const LENGTH_TEXT = /^\d{1,2}$/u;
/** ASCII digits only. */
const DIGITS = /^\d+$/u;
const MIN_OTP_LENGTH = 4;
const MAX_OTP_LENGTH = 10;

/** The stated OTP length, or false when the hook states none. */
type StatedLength = number | false;

/**
 * Read the cookie a request would use after one client write, without writing it.
 * @param jar - Run's cookie session.
 * @param url - Step URL.
 * @param client - Cookie the step would set.
 * @returns The raw value selected by the domain jar's precedence rules.
 */
function previewCookie(jar: ICookieSession, url: string, client: IClientCookie): Option<string> {
  const stored = jar.exportAll();
  const allow = stored
    .filter((entry): boolean => !entry.hostOnly)
    .map((entry): string => entry.domain);
  const preview = createDomainCookieJar(url, allow);
  preview.importAll(stored);
  preview.set(url, client);
  return preview.cookieFor(url, client.name);
}

/**
 * Resolve a required cookie using the same precedence as the request.
 * @param view - Guard bundle and jar.
 * @param name - Required cookie name.
 * @returns Selected value, missing value, or a cookie-source failure.
 */
function pendingCookie(view: IPendingCookieView, name: string): CookieRead {
  const stored = view.jar.cookieFor.bind(null, view.url);
  const own = view.args.step.setCookies;
  if (own === undefined || !Object.hasOwn(own, name)) return stored(name);
  const scope = { ...view.args.scope, cookie: stored };
  const pending = clientCookieOf(view.args.step, scope, [name, own[name]]);
  if (!isOk(pending)) return cookieRefOf(own[name]).startsWith('cookie.') ? pending : none();
  if (!pending.value.has) return stored(name);
  return previewCookie(view.jar, view.url, pending.value.value);
}

/**
 * Presents cookies the step will send without setting them before the guard.
 * @param args - Guard bundle.
 * @param jar - Run's cookie session.
 * @param url - Step URL.
 * @returns Lookup using the same domain/path precedence as the request.
 */
function stepCookieView(args: IPreHookGuardArgs, jar: ICookieSession, url: string): CookieLookup {
  const view: IPendingCookieView = { args, jar, url };
  return (name: string): CookieRead => pendingCookie(view, name);
}

/**
 * Resolve the guarded step's URL under its carried URL rules.
 * @param args - Guard bundle.
 * @returns The URL, or a refusal before the pre-hook requests a secret.
 */
function guardedStepUrl(args: IPreHookGuardArgs): Procedure<string> {
  const { step, scope, reduce } = args;
  const { companyId, carriedUrlRules } = reduce;
  return stepBaseUrlOf({ step, scope, companyId, carriedUrlRules });
}

/**
 * Validate the step URL and bind the jar view when the run has a jar.
 * @param args - Guard bundle.
 * @returns The bound scope, the scope unchanged without a jar, or a failure.
 */
function stepJarScope(args: IPreHookGuardArgs): Procedure<ITemplateScope> {
  const url = guardedStepUrl(args);
  if (!isOk(url)) return url;
  const jar = args.reduce.bus.cookies;
  if (jar === undefined) return succeed(args.scope);
  const cookie = stepCookieView(args, jar, url.value);
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
 * Validate the URL and the pre-hook's `requires` refs before acquiring a code.
 * @param args - Guard bundle.
 * @returns The scope unchanged, or the resolver's failure.
 */
function checkPreHookRequires(args: IPreHookGuardArgs): Procedure<ITemplateScope> {
  const bound = stepJarScope(args);
  if (!isOk(bound)) return bound;
  const tokens = args.hook.requires ?? [];
  if (tokens.length === 0) return succeed(args.scope);
  const resolved = tokens.map((token): Procedure<JsonValue> => resolveRef(token, bound.value));
  const miss = resolved.find(isMiss);
  return miss ?? succeed(args.scope);
}

/**
 * Read a stated OTP length: an integer 4..10, as a number or decimal text.
 * @param raw - The carry slot's value.
 * @returns The length, or false when it is not one.
 */
function lengthOf(raw: JsonValue): StatedLength {
  const text = typeof raw === 'number' ? String(raw) : raw;
  if (typeof text !== 'string' || !LENGTH_TEXT.test(text)) return false;
  const length = Number(text);
  if (length < MIN_OTP_LENGTH || length > MAX_OTP_LENGTH) return false;
  return length;
}

/**
 * Read the OTP length the hook's `valueLengthRef` slot states.
 * @param args - Guard bundle.
 * @returns The length, false when the hook or carry states none, or a failure.
 */
function statedLength(args: IPreHookGuardArgs): Procedure<StatedLength> {
  const ref = args.hook.valueLengthRef;
  if (ref === undefined) return succeed(false);
  const slot = ref.slice(CARRY_PREFIX.length);
  if (!Object.hasOwn(args.scope.carry, slot)) return succeed(false);
  const length = lengthOf(args.scope.carry[slot]);
  if (length !== false) return succeed(length);
  return fail(ScraperErrorTypes.Generic, `${args.step.name} preHook length invalid`);
}

/**
 * Check the `requires` refs, then read the stated OTP length.
 * @param args - Guard bundle.
 * @returns The stated length, or the first failure.
 */
function checkPreHookReady(args: IPreHookGuardArgs): Procedure<StatedLength> {
  const ready = checkPreHookRequires(args);
  if (!isOk(ready)) return ready;
  return statedLength(args);
}

/**
 * Whether a deposited value matches the hook's `valuePattern`, if any.
 * @param args - Guard bundle.
 * @param value - The deposited value.
 * @returns True when the hook sets no pattern or the value matches it.
 */
function matchesPattern(args: IPreHookGuardArgs, value: JsonValue): boolean {
  if (args.hook.valuePattern === undefined) return true;
  const pattern = new RegExp(args.hook.valuePattern, 'u');
  return typeof value === 'string' && pattern.test(value);
}

/**
 * Whether a deposited value has the stated length in ASCII digits, if any.
 * @param value - The deposited value.
 * @param length - The stated length, or false.
 * @returns True when no length is stated or the value has it.
 */
function hasStatedLength(value: JsonValue, length: StatedLength): boolean {
  if (length === false) return true;
  return typeof value === 'string' && value.length === length && DIGITS.test(value);
}

/**
 * Check the deposited pre-hook value against `valuePattern` and the stated length.
 * @param args - Guard bundle.
 * @param scope - Scope after the pre-hook deposited its value.
 * @param length - The stated OTP length, or false.
 * @returns The scope unchanged, or an InvalidOtp failure naming no value.
 */
function checkPreHookValue(
  args: IPreHookGuardArgs,
  scope: ITemplateScope,
  length: StatedLength,
): Procedure<ITemplateScope> {
  const value = scope.carry[args.hook.intoCarryField];
  if (matchesPattern(args, value) && hasStatedLength(value, length)) return succeed(scope);
  return fail(ScraperErrorTypes.InvalidOtp, `${args.step.name} preHook value invalid`);
}

/**
 * Run the step's pre-hook between its `requires`/length and value guards.
 * @param args - Guard bundle.
 * @returns Scope carrying the deposited value, or the first guard/hook failure.
 */
async function applyGuardedPreHook(args: IPreHookGuardArgs): Promise<Procedure<ITemplateScope>> {
  const ready = checkPreHookReady(args);
  if (!isOk(ready)) return ready;
  const { scope, hook } = args;
  const hookArgs = { scope, creds: args.reduce.creds, hook, cache: args.reduce.preHookCache };
  const hooked = await applyPreHook(hookArgs);
  if (!isOk(hooked)) return hooked;
  return checkPreHookValue(args, hooked.value, ready.value);
}

export default applyGuardedPreHook;
export { applyGuardedPreHook };
