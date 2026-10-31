/**
 * Domain cookie jar — the RFC 6265 subset jar a bank opts into with
 * `cookieDomains`. One store per run keyed by name + domain + path (§5.3:
 * a new cookie replaces the stored one with that key, keeping its creation
 * order); requests get every applicable cookie, longer path first, then
 * creation order. Adds the session operations the cookie-session port needs:
 * read one cookie, set a client cookie, export, import (replaces) and clear.
 * Every way in keeps out a cookie that cannot travel as `name=value` in a
 * Cookie header, and an imported domain cookie outside the allow-list.
 * An unparseable URL neither keeps nor sends a cookie. Never logs values.
 */

import type { IClientCookie, IStoredCookie } from '../../Types/Domain/CookieSession.js';
import type { Option } from '../../Types/Option.js';
import { none, some } from '../../Types/Option.js';
import type { ICookieTarget } from './CookieMatch.js';
import { cookieApplies, isExpired, nowEpochS, SESSION_EXPIRY, targetOf } from './CookieMatch.js';
import { isSendableCookie } from './HeaderText.js';
import type { IOriginCookieJar } from './OriginCookieJar.js';
import { parseSetCookie } from './SetCookieScope.js';

/** The domain jar: the origin jar's add/header plus the session operations. */
interface IDomainCookieJar extends IOriginCookieJar {
  readonly cookieFor: (url: string, name: string) => Option<string>;
  readonly set: (url: string, cookie: IClientCookie) => number;
  readonly exportAll: () => readonly IStoredCookie[];
  readonly importAll: (cookies: readonly IStoredCookie[]) => number;
  readonly clear: () => number;
}

/** One jar's state: its store, base URL and domain allow-list. */
interface IJarState {
  readonly store: Map<string, IStoredCookie>;
  readonly baseUrl: string;
  readonly allow: readonly string[];
}

/**
 * Whether a cookie may enter the jar: sendable as `name=value`, and either
 * host-only or scoped to an allow-listed domain.
 * @param state - Jar state.
 * @param cookie - Candidate cookie.
 * @returns True when the cookie may be stored.
 */
function isStorable(state: IJarState, cookie: IStoredCookie): boolean {
  if (!isSendableCookie(cookie.name, cookie.value)) return false;
  return cookie.hostOnly || state.allow.includes(cookie.domain);
}

/**
 * Store a cookie under its RFC key, or delete the key when it has expired;
 * a cookie the jar may not hold is ignored.
 * @param state - Jar state.
 * @param cookie - Cookie to store.
 * @returns The store size.
 */
function upsert(state: IJarState, cookie: IStoredCookie): number {
  if (!isStorable(state, cookie)) return state.store.size;
  const key = [cookie.name, cookie.domain, cookie.path].join(';');
  const nowS = nowEpochS();
  if (isExpired(cookie, nowS)) state.store.delete(key);
  if (!isExpired(cookie, nowS)) state.store.set(key, cookie);
  return state.store.size;
}

/**
 * Store every in-scope Set-Cookie line of a response.
 * @param state - Jar state.
 * @param url - URL of the response that carried the lines.
 * @param lines - Raw Set-Cookie lines.
 * @returns The store size.
 */
function addLines(state: IJarState, url: string, lines: readonly string[]): number {
  const target = targetOf(state.baseUrl, url);
  if (target === false) return state.store.size;
  const context = { target, allow: state.allow, nowS: nowEpochS() };
  const parsed = lines.map((line): IStoredCookie | false => parseSetCookie(line, context));
  const cookies = parsed.filter((cookie): cookie is IStoredCookie => cookie !== false);
  for (const cookie of cookies) upsert(state, cookie);
  return state.store.size;
}

/**
 * Sort order: longer path first; `sort` is stable, so ties keep creation order.
 * @param left - First cookie.
 * @param right - Second cookie.
 * @returns Negative when left sorts first.
 */
function byLongerPath(left: IStoredCookie, right: IStoredCookie): number {
  return right.path.length - left.path.length;
}

/**
 * Cookies for a request, longer path first, then creation order.
 * @param state - Jar state.
 * @param url - Request URL.
 * @returns The applicable cookies.
 */
function applicable(state: IJarState, url: string): readonly IStoredCookie[] {
  const target = targetOf(state.baseUrl, url);
  if (target === false) return [];
  const nowS = nowEpochS();
  const stored = [...state.store.values()];
  const hits = stored.filter((cookie): boolean => cookieApplies(cookie, target, nowS));
  return hits.sort(byLongerPath);
}

/**
 * The Cookie header value for a request.
 * @param state - Jar state.
 * @param url - Request URL.
 * @returns `k=v; k2=v2`, or '' when no cookie applies.
 */
function headerFor(state: IJarState, url: string): string {
  const cookies = applicable(state, url);
  const pairs = cookies.map((cookie): string => `${cookie.name}=${cookie.value}`);
  return pairs.join('; ');
}

/**
 * The raw value of the first applicable cookie with a name.
 * @param state - Jar state.
 * @param url - Request URL.
 * @param name - Cookie name.
 * @returns The value, or none.
 */
function cookieFor(state: IJarState, url: string, name: string): Option<string> {
  const cookies = applicable(state, url);
  const hit = cookies.find((cookie): boolean => cookie.name === name);
  if (hit === undefined) return none();
  return some(hit.value);
}

/**
 * A client cookie as stored: host-only to the request host, session lifetime.
 * @param cookie - Client cookie.
 * @param target - Request scope.
 * @returns The stored cookie.
 */
function clientToStored(cookie: IClientCookie, target: ICookieTarget): IStoredCookie {
  const path = cookie.path ?? '/';
  const isSecure = cookie.secure ?? true;
  const scope = { domain: target.host, hostOnly: true, expiresEpochS: SESSION_EXPIRY };
  return { name: cookie.name, value: cookie.value, path, secure: isSecure, ...scope };
}

/**
 * Set a client cookie for a request URL.
 * @param state - Jar state.
 * @param url - Request URL.
 * @param cookie - Client cookie.
 * @returns The store size.
 */
function setClient(state: IJarState, url: string, cookie: IClientCookie): number {
  const target = targetOf(state.baseUrl, url);
  if (target === false) return state.store.size;
  const stored = clientToStored(cookie, target);
  return upsert(state, stored);
}

/**
 * Replace the jar with imported cookies (expired ones are skipped).
 * @param state - Jar state.
 * @param cookies - Cookies to import, in creation order.
 * @returns The store size.
 */
function importAll(state: IJarState, cookies: readonly IStoredCookie[]): number {
  state.store.clear();
  for (const cookie of cookies) upsert(state, cookie);
  return state.store.size;
}

/**
 * Unexpired cookies in creation order.
 * @param state - Jar state.
 * @returns The exported cookies.
 */
function exportAll(state: IJarState): readonly IStoredCookie[] {
  const nowS = nowEpochS();
  const stored = [...state.store.values()];
  return stored.filter((cookie): boolean => !isExpired(cookie, nowS));
}

/**
 * Empty the jar.
 * @param state - Jar state.
 * @returns The store size (0).
 */
function clearJar(state: IJarState): number {
  return importAll(state, []);
}

/**
 * Bind the session operations to one jar's state.
 * @param state - Jar state.
 * @returns cookieFor, set, exportAll, importAll and clear.
 */
function bindSessionOps(state: IJarState): Omit<IDomainCookieJar, keyof IOriginCookieJar> {
  return {
    cookieFor: cookieFor.bind(null, state),
    set: setClient.bind(null, state),
    exportAll: exportAll.bind(null, state),
    importAll: importAll.bind(null, state),
    clear: clearJar.bind(null, state),
  };
}

/**
 * Build a domain jar for one transport.
 * @param baseUrl - The transport's base URL, which relative URLs join.
 * @param allow - Registrable domains whose `Domain` cookies are kept.
 * @returns The jar.
 */
function createDomainCookieJar(baseUrl: string, allow: readonly string[]): IDomainCookieJar {
  const state: IJarState = { store: new Map(), baseUrl, allow };
  const sessionOps = bindSessionOps(state);
  return { add: addLines.bind(null, state), header: headerFor.bind(null, state), ...sessionOps };
}

export type { IDomainCookieJar };
export { createDomainCookieJar };
