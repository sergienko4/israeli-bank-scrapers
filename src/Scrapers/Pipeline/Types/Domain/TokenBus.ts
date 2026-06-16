/**
 * ITokenBus — the minimal ApiMediator capability the token lifecycle needs:
 * a single authenticated POST. A narrow port (ISP/DIP) so token strategies and
 * the config-driven flow depend on this one method rather than the full
 * `IApiMediator` god-interface, keeping them outside the ApiMediator SCC.
 */

import type { WKUrlGroup } from '../../Registry/WK/UrlsWK.js';
import type { Procedure } from '../Procedure.js';
import type { IApiQueryOpts } from './ApiQueryOpts.js';

interface ITokenBus {
  apiPost: <T>(
    wkUrl: WKUrlGroup,
    body: Record<string, unknown>,
    opts?: IApiQueryOpts,
  ) => Promise<Procedure<T>>;
}

export type { ITokenBus };
