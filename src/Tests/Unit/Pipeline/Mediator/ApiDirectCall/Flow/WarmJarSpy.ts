/**
 * A cookie session for warm-start suites: it exports scripted cookies and
 * records every import and clear against how many requests had gone out, so
 * a test can assert the order of jar events and bank calls. Its client-cert
 * port logs installs and clears into the same list. A real domain jar backs
 * the suites that assert what a later request would be sent.
 */

import {
  createDomainCookieJar,
  type IDomainCookieJar,
} from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/DomainCookieJar.js';
import type { IClientCertControl } from '../../../../../../Scrapers/Pipeline/Types/Domain/ClientCertControl.js';
import type {
  ICookieSession,
  IStoredCookie,
} from '../../../../../../Scrapers/Pipeline/Types/Domain/CookieSession.js';
import { none, type Option } from '../../../../../../Scrapers/Pipeline/Types/Option.js';
import type { Procedure } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
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

/** A cookie session and cert port that record events against the request count. */
interface IJarSpy {
  readonly session: ICookieSession;
  readonly cert: IClientCertControl;
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
 * A client-cert port recording each install and clear.
 * @param sink - Event log and request log.
 * @returns The port.
 */
function makeCertSpy(sink: IJarSink): IClientCertControl {
  /**
   * Record an install.
   * @returns Accepted.
   */
  const install = (): Procedure<true> => {
    recordAt(sink, 'cert-install');
    return succeed(true);
  };
  /**
   * Record a clear.
   * @returns True (ack contract).
   */
  const clear = (): true => {
    recordAt(sink, 'cert-clear');
    return true;
  };
  return { install, clear };
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
  const cert = makeCertSpy(sink);
  return { session: { ...INERT_SESSION, importAll, clear, exportAll }, cert, events };
}

/** A real domain jar and the cookie-session port the transport hands the bus. */
interface IDomainSession {
  readonly jar: IDomainCookieJar;
  readonly session: ICookieSession;
}

/** A scrape read on a sibling host of the login; `Path=/` gateway cookies match it. */
const BANCS_URL = 'https://mobile.bank.example/BaNCSDigitalApp/account';

/**
 * An empty real domain jar for the warm cookies' domain, behind a session port.
 * @returns The jar and its session.
 */
function makeDomainSession(): IDomainSession {
  const jar = createDomainCookieJar('https://login.bank.example', ['bank.example']);
  const { cookieFor, set, exportAll, importAll, clear } = jar;
  const { headerFor } = INERT_SESSION;
  return { jar, session: { cookieFor, headerFor, set, exportAll, importAll, clear } };
}

export type { IJarSpy };
export { BANCS_URL, COOKIE_MARKER, makeDomainSession, makeJarSpy, WARM_COOKIES };
