/**
 * ITokenBus — the minimal ApiMediator capability the token lifecycle needs:
 * an authenticated POST, a GET for body-less login steps, and — for a bank
 * with a domain cookie jar — the run's cookie session. A narrow port
 * (ISP/DIP) so token strategies and the config-driven flow depend on these two
 * methods rather than the full `IApiMediator` god-interface, keeping them
 * outside the ApiMediator SCC.
 */

import type { WKUrlGroup } from '../../Registry/WK/UrlsWK.js';
import type { Procedure } from '../Procedure.js';
import type { ApiPostData } from './ApiPostData.js';
import type { IApiQueryOpts } from './ApiQueryOpts.js';
import type { ICookieSession } from './CookieSession.js';

interface ITokenBus {
  apiPost: <T>(wkUrl: WKUrlGroup, body: ApiPostData, opts?: IApiQueryOpts) => Promise<Procedure<T>>;
  apiGet: <T>(wkUrl: WKUrlGroup, opts?: IApiQueryOpts) => Promise<Procedure<T>>;
  /** The run's cookie session; present only when the bank sets `cookieDomains`. */
  readonly cookies?: ICookieSession;
}

export type { ITokenBus };
