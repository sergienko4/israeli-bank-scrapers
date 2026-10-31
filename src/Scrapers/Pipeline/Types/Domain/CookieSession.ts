/**
 * Cookie session — the one port onto a run's session jar, plus the cookies the
 * jar stores and the cookies a login step may set itself. The session
 * transport (layer 4) owns the jar and hands this port to the token bus; the
 * flow and warm start read and restore it through the port, so it lives here
 * and imports flow downward only.
 */

import type { Option } from '../Option.js';

/** One stored cookie with its RFC 6265 scope. Values are secrets; never log them. */
interface IStoredCookie {
  readonly name: string;
  readonly value: string;
  /** Lower-case host (host-only) or registrable domain (domain cookie). */
  readonly domain: string;
  readonly path: string;
  /** True when only the exact `domain` host may receive the cookie. */
  readonly hostOnly: boolean;
  readonly secure: boolean;
  /** Expiry in epoch seconds; 0 means a session cookie. */
  readonly expiresEpochS: number;
}

/** A cookie a login step sets itself — host-only to the step's host. */
interface IClientCookie {
  readonly name: string;
  readonly value: string;
  /** Default `/`. */
  readonly path?: string;
  /** Default true. */
  readonly secure?: boolean;
}

/** The run's cookie session. Values are secrets; never log them. */
interface ICookieSession {
  /** Raw value of the first cookie named `name` that applies to `url`. */
  readonly cookieFor: (url: string, name: string) => Option<string>;
  /** The full Cookie header the transport would send to `url`. */
  readonly headerFor: (url: string) => Option<string>;
  /** Set a client cookie for `url`; returns the jar size. */
  readonly set: (url: string, cookie: IClientCookie) => number;
  /** Every unexpired cookie, in creation order. */
  readonly exportAll: () => readonly IStoredCookie[];
  /** Replace the whole jar (expired cookies skipped); returns the jar size. */
  readonly importAll: (cookies: readonly IStoredCookie[]) => number;
  /** Drop every cookie; returns 0. */
  readonly clear: () => number;
}

export type { IClientCookie, ICookieSession, IStoredCookie };
