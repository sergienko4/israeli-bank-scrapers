/**
 * A cookie session for warm-start suites: it exports scripted cookies and
 * records every import and clear against how many requests had gone out, so
 * a test can assert the order of jar events and bank calls.
 */

import type {
  ICookieSession,
  IStoredCookie,
} from '../../../../../../Scrapers/Pipeline/Types/Domain/CookieSession.js';
import { none, type Option } from '../../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IApiPostCapture } from './StubMediator.js';

/** Every cookie value carries this marker, so a leaked value is easy to spot. */
const COOKIE_MARKER = 'syn-secret-';

/** Two cookies on sibling hosts, one session and one dated. */
const WARM_COOKIES: readonly IStoredCookie[] = [
  {
    name: 'SMSESSION',
    value: `${COOKIE_MARKER}session`,
    domain: 'bank.example',
    path: '/',
    hostOnly: false,
    secure: true,
    expiresEpochS: 0,
  },
  {
    name: 'XSRF-TOKEN',
    value: `${COOKIE_MARKER}xsrf`,
    domain: 'login.bank.example',
    path: '/auth',
    hostOnly: true,
    secure: true,
    expiresEpochS: 4102444800,
  },
];

/** A cookie session that records imports and clears against the request count. */
interface IJarSpy {
  readonly session: ICookieSession;
  readonly events: string[];
}

/** The parts of a cookie session no warm start reads. */
const INERT_SESSION: Pick<ICookieSession, 'cookieFor' | 'headerFor' | 'set'> = {
  /**
   * No cookie is read.
   * @returns None.
   */
  cookieFor: (): Option<string> => none(),
  /**
   * No Cookie header.
   * @returns None.
   */
  headerFor: (): Option<string> => none(),
  /**
   * Ignore a client cookie.
   * @returns Jar size.
   */
  set: (): number => 0,
};

/** Where jar events land, tagged with how many requests had gone out. */
interface IJarSink {
  readonly events: string[];
  readonly captures: readonly IApiPostCapture[];
}

/**
 * Record a jar event tagged with how many requests had gone out.
 * @param sink - Event log and the run's request log.
 * @param label - Event name.
 * @returns The event count.
 */
function recordAt(sink: IJarSink, label: string): number {
  const sent = String(sink.captures.length);
  return sink.events.push(`${label}@${sent}`);
}

/**
 * Record an import.
 * @param sink - Event log and request log.
 * @param cookies - Imported cookies.
 * @returns Jar size.
 */
function importInto(sink: IJarSink, cookies: readonly IStoredCookie[]): number {
  const count = String(cookies.length);
  recordAt(sink, `import${count}`);
  return cookies.length;
}

/**
 * Record a clear.
 * @param sink - Event log and request log.
 * @returns Jar size (0).
 */
function clearInto(sink: IJarSink): number {
  recordAt(sink, 'clear');
  return 0;
}

/**
 * A cookie session exporting the given cookies and recording imports/clears.
 * @param captures - The run's request log.
 * @param exported - What `exportAll` returns.
 * @returns The session and its event log.
 */
function makeJarSpy(
  captures: readonly IApiPostCapture[],
  exported: readonly IStoredCookie[],
): IJarSpy {
  const events: string[] = [];
  const sink: IJarSink = { events, captures };
  /**
   * Record an import.
   * @param cookies - Imported cookies.
   * @returns Jar size.
   */
  const importAll = (cookies: readonly IStoredCookie[]): number => importInto(sink, cookies);
  /**
   * Record a clear.
   * @returns Jar size (0).
   */
  const clear = (): number => clearInto(sink);
  /**
   * Export the scripted cookies.
   * @returns The cookies.
   */
  const exportAll = (): readonly IStoredCookie[] => exported;
  return { session: { ...INERT_SESSION, importAll, clear, exportAll }, events };
}

export type { IJarSpy };
export { COOKIE_MARKER, makeJarSpy, WARM_COOKIES };
