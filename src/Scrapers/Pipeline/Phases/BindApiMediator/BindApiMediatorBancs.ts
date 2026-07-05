/**
 * BIND-API-MEDIATOR BaNCS prime — capture the session-specific fields Yahav's
 * TCS BaNCS `MessageEnvelope` needs (the auth `SecToken` block + the portfolio
 * `iorId`/`Id`) from the live discovery pool and stash them on the mediator
 * session-context.
 *
 * Why the pool already holds them: the network-trace lifecycle interceptor
 * opens capture at `pre-login`, so the accounts POST the SPA fires during
 * login/boot is recorded before BIND runs. That request's `postData` carries a
 * FILLED `SecToken.Token[0]` + `Payload.DataEntity[0].Prtflio.Id` — this prime
 * inspects ONLY that endpoint family (`/BaNCSDigitalApp/account`), never the
 * credential POST, so it is PII-safe by extraction scope. Opt-in per bank via
 * `bancsSessionCapture`; banks that omit it yield `none()`. Mirrors the
 * session-token / client-version primes — merges into the existing context,
 * no bank coupling.
 */

import type { IApiMediator } from '../../Mediator/Api/ApiMediator.types.js';
import type { INetworkDiscovery } from '../../Mediator/Network/Types/Discovery.js';
import type { IDiscoveredEndpoint } from '../../Mediator/Network/Types/Endpoint.js';
import type { ApiRecord } from '../../Mediator/Scrape/AutoMapperFacade/AutoMapperTypes.js';
import { getIn, isRecord, isStr } from '../../Mediator/Scrape/Bancs/BancsShape.js';
import type { IPipelineBankConfig } from '../../Registry/Config/PipelineBankConfigTypes.js';
import type { Option } from '../../Types/Option.js';
import { none, some } from '../../Types/Option.js';
import { scanCsrf } from './BindApiMediatorBancsCsrf.js';

/** The BaNCS multiplexed data path — the pooled request family to inspect. */
const ACCOUNT_URL_MATCH = '/BaNCSDigitalApp/account';

/** Path to the portfolio Id leaf in an accounts request postData Payload. */
const PRTFLIO_ID_PATH = ['Payload', 'DataEntity', '0', 'Prtflio', 'Id', 'Id'];

/** Path to the portfolio iorId leaf in an accounts request postData Payload. */
const PRTFLIO_IORID_PATH = ['Payload', 'DataEntity', '0', 'Prtflio', 'Id', 'iorId'];

/** The captured BaNCS session values keyed on the mediator session-context. */
export interface IBancsCapture {
  readonly bancsSecToken: string;
  readonly bancsPortfolioIorId: string;
  readonly bancsPortfolioId: string;
}

/**
 * Parse a request postData JSON string to a record (empty on failure).
 * @param raw - Candidate JSON string.
 * @returns Parsed record, or empty when malformed.
 */
function parseBody(raw: string): ApiRecord {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Read the portfolio `{iorId, Id}` from an accounts request postData.
 * @param body - Parsed request postData.
 * @returns Portfolio refs, or `false` when either is absent/empty.
 */
function readPortfolio(body: ApiRecord): { iorId: string; id: string } | false {
  const id = getIn(body, PRTFLIO_ID_PATH);
  const iorId = getIn(body, PRTFLIO_IORID_PATH);
  if (!isStr(id) || !isStr(iorId)) return false;
  if (id.length === 0 || iorId.length === 0) return false;
  return { iorId, id };
}

/**
 * Read + stringify the whole `SecToken` block, gated on a present TokenId.
 * @param body - Parsed request postData.
 * @returns Stringified SecToken block, or `false` when absent.
 */
function readSecToken(body: ApiRecord): string | false {
  const sec = body.SecToken;
  if (!isRecord(sec)) return false;
  const tokenId = getIn(sec, ['Token', '0', 'TokenId']);
  if (!isStr(tokenId) || tokenId.length === 0) return false;
  return JSON.stringify(sec);
}

/**
 * Extract the BaNCS capture from a single pooled accounts request.
 * @param ep - Captured endpoint.
 * @returns Capture bundle, or `false` when this endpoint has none.
 */
function captureFrom(ep: IDiscoveredEndpoint): IBancsCapture | false {
  if (ep.method !== 'POST') return false;
  if (!ep.url.includes(ACCOUNT_URL_MATCH)) return false;
  const body = parseBody(ep.postData);
  const secToken = readSecToken(body);
  const portfolio = readPortfolio(body);
  if (secToken === false || portfolio === false) return false;
  return {
    bancsSecToken: secToken,
    bancsPortfolioIorId: portfolio.iorId,
    bancsPortfolioId: portfolio.id,
  };
}

/**
 * Scan the discovery pool for the first accounts request yielding a capture.
 * @param pool - Login-inclusive discovery captures.
 * @returns Capture bundle, or `false`.
 */
function scanPool(pool: readonly IDiscoveredEndpoint[]): IBancsCapture | false {
  const hits = pool.map(captureFrom);
  const hit = hits.find((c): c is IBancsCapture => c !== false);
  return hit ?? false;
}

/**
 * Prime the mediator session-context with the captured BaNCS session values
 * for banks that declare `bancsSessionCapture` (yields `none()` otherwise).
 * @param config - Resolved bank config carrying `bancsSessionCapture`.
 * @param network - Element-mediator network discovery (login captures).
 * @param mediator - Browser-page mediator to enrich.
 * @returns `some(capture)` when stashed, `none()` otherwise.
 */
function primeBancsSession(
  config: IPipelineBankConfig,
  network: INetworkDiscovery,
  mediator: IApiMediator,
): Option<IBancsCapture> {
  if (config.bancsSessionCapture !== true) return none();
  const pool = network.getAllEndpoints();
  const capture = scanPool(pool);
  if (capture === false) return none();
  const csrf = scanCsrf(pool);
  const merged = { ...mediator.getSessionContext(), ...capture, ...csrf };
  mediator.setSessionContext(merged);
  return some(capture);
}

export default primeBancsSession;
export { primeBancsSession };
