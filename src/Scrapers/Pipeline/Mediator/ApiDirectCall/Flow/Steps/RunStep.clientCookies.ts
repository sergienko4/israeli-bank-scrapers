/**
 * Client cookies of one step. Over the run's domain jar the step
 * gets a jar view bound to its URL — what `cookie.<name>` refs read — and its
 * `setCookies` are resolved, checked and written host-only with `Path=/;
 * Secure` before its request, so they travel on it and on later requests.
 * Without a domain jar a step naming `setCookies` fails before any request.
 */

import { ScraperErrorTypes } from '../../../../../Base/ErrorTypes.js';
import type { IClientCookie, ICookieSession } from '../../../../Types/Domain/CookieSession.js';
import { none, type Option, some } from '../../../../Types/Option.js';
import type {
  IProcedureFailure,
  IProcedureSuccess,
  Procedure,
} from '../../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../../Types/Procedure.js';
import type { ClientCookieSource, RefToken } from '../../ConfigContracts/index.js';
import type { JsonValue } from '../../Envelope/JsonPointer.js';
import { isRefAbsent } from '../../Template/RefPresence.js';
import { type ITemplateScope, resolveRef } from '../../Template/RefResolver.js';
import { stepBaseUrlOf } from './RunStep.stepUrl.js';
import type { IRunStepArgs, IStepConfig } from './RunStep.types.js';

/** RFC 6265 cookie-octets, 1 to 4096 of them. */
const COOKIE_VALUE = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]{1,4096}$/;
const NO_CLIENT_COOKIE: Option<IClientCookie> = none();

/** One `setCookies` entry: cookie name and its source. */
type SetCookieEntry = readonly [string, ClientCookieSource];

/**
 * The reference named by a cookie source.
 * @param source - Required or optional cookie source.
 * @returns Its ref token.
 */
function cookieRefOf(source: ClientCookieSource): RefToken {
  return typeof source === 'string' ? source : source.ref;
}

/**
 * Check a resolved client-cookie value.
 * @param stepName - Step name, for the failure text.
 * @param name - Cookie name.
 * @param value - Resolved value.
 * @returns Procedure with the cookie, or a failure naming no value.
 */
function checkedCookie(stepName: string, name: string, value: JsonValue): Procedure<IClientCookie> {
  if (typeof value === 'string' && COOKIE_VALUE.test(value)) return succeed({ name, value });
  return fail(ScraperErrorTypes.Generic, `${stepName} setCookies ${name} invalid`);
}

/**
 * Wraps a checked cookie as a present optional result.
 * @param checked - Checked cookie or failure.
 * @returns Optional cookie or the original failure.
 */
function optionalCookie(checked: Procedure<IClientCookie>): Procedure<Option<IClientCookie>> {
  if (!isOk(checked)) return checked;
  const cookie = some(checked.value);
  return succeed(cookie);
}

/**
 * Check a present value or omit an explicitly optional empty value.
 * @param stepName - Step name for a refusal.
 * @param entry - Cookie name and source.
 * @param value - Resolved value.
 * @returns Checked cookie or explicit absence.
 */
function cookieValueOf(
  stepName: string,
  entry: SetCookieEntry,
  value: JsonValue,
): Procedure<Option<IClientCookie>> {
  if (typeof entry[1] !== 'string' && value === '') return succeed(NO_CLIENT_COOKIE);
  const checked = checkedCookie(stepName, entry[0], value);
  return optionalCookie(checked);
}

/**
 * Resolve one client cookie and check its value.
 * @param step - Step config.
 * @param scope - Step scope.
 * @param entry - Cookie name and ref.
 * @returns Procedure with an optional cookie, or a failure naming no value.
 */
function clientCookieOf(
  step: IStepConfig,
  scope: ITemplateScope,
  entry: SetCookieEntry,
): Procedure<Option<IClientCookie>> {
  const ref = cookieRefOf(entry[1]);
  if (typeof entry[1] !== 'string' && isRefAbsent(ref, scope)) return succeed(NO_CLIENT_COOKIE);
  const resolved = resolveRef(ref, scope);
  return isOk(resolved) ? cookieValueOf(step.name, entry, resolved.value) : resolved;
}

/**
 * Whether a client cookie failed to resolve.
 * @param proc - Resolved cookie.
 * @returns True on failure.
 */
function isFailed(proc: Procedure<Option<IClientCookie>>): proc is IProcedureFailure {
  return !isOk(proc);
}

/**
 * Collects a present cookie or no cookie for an absent optional source.
 * @param result - Successfully resolved optional cookie.
 * @returns Zero or one cookie.
 */
function presentCookie(result: IProcedureSuccess<Option<IClientCookie>>): readonly IClientCookie[] {
  const value = result.value;
  return value.has ? [value.value] : [];
}

/**
 * Resolve every client cookie of a step; the first bad one fails them all.
 * @param step - Step config.
 * @param scope - Step scope.
 * @returns Procedure with the cookies, in config order.
 */
function clientCookiesOf(step: IStepConfig, scope: ITemplateScope): Procedure<IClientCookie[]> {
  const entries = Object.entries(step.setCookies ?? {});
  const resolve = clientCookieOf.bind(null, step, scope);
  const resolved = entries.map(resolve);
  const failed = resolved.find(isFailed);
  if (failed !== undefined) return failed;
  const cookies = resolved.filter(isOk).flatMap(presentCookie);
  return succeed(cookies);
}

/**
 * A step on a run without a domain jar: fine unless it sets cookies.
 * @param args - Run-step args.
 * @returns The args unchanged, or a failure.
 */
function withoutJar(args: IRunStepArgs): Procedure<IRunStepArgs> {
  const names = Object.keys(args.step.setCookies ?? {});
  if (names.length === 0) return succeed(args);
  return fail(ScraperErrorTypes.Generic, `${args.step.name} setCookies needs a cookie session`);
}

/**
 * Bind the jar view to the step URL and write the step's client cookies.
 * @param args - Run-step args.
 * @param jar - The run's domain jar.
 * @returns The args with the bound scope, or a failure.
 */
function withJar(args: IRunStepArgs, jar: ICookieSession): Procedure<IRunStepArgs> {
  const url = stepBaseUrlOf(args);
  if (!isOk(url)) return url;
  const cookie = jar.cookieFor.bind(null, url.value);
  const scope = { ...args.scope, cookie };
  const cookies = clientCookiesOf(args.step, scope);
  if (!isOk(cookies)) return cookies;
  for (const client of cookies.value) jar.set(url.value, client);
  return succeed({ ...args, scope });
}

/**
 * Prepare a step's client cookies before its URL, body or headers resolve.
 * @param args - Run-step args.
 * @returns The args with the step's jar view in scope, or a failure.
 */
function bindStepCookies(args: IRunStepArgs): Procedure<IRunStepArgs> {
  const jar = args.bus.cookies;
  if (jar === undefined) return withoutJar(args);
  return withJar(args, jar);
}

export default bindStepCookies;
export { bindStepCookies, clientCookieOf, cookieRefOf };
