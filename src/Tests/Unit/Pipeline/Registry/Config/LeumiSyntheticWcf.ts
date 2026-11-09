/**
 * Synthetic Leumi WCF peer for the native login-to-scrape flow.
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import { LEUMI_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/Leumi/scrape/LeumiShape.js';
import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import {
  buildApiDirectScrapePhase,
  createApiDirectScrapePhase,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapePhase.js';
import type { JsonUnknownRecord } from '../../../../../Scrapers/Pipeline/Types/JsonValue.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

type WcfStage = 'customer' | 'balance' | 'transactions';

interface IWcfRequest {
  readonly moduleName: unknown;
  readonly inner: JsonUnknownRecord;
}

const ACCOUNT = { AccountIndex: 0, MaskedNumber: '99-12345/88' };
const STATUS = { Status: true, SOStatusItem: null };
const ROWS = [
  { DateUTC: '2025-12-31', Description: 'older', Amount: 1, FITID: 'prior' },
  { DateUTC: '2026-02-01', Description: 'market', Amount: -10, FITID: 'current' },
];
const SPA_SESSION = 'ABCDEF0123456789ABCDEF0123456789';
const GATE = '/staticcontent/gate-keeper/';
const SDK = `${GATE}js/transmit/8.1/xmsdk.js`;
const SYNTHETIC_SDK = 'synthetic public SDK bytes';

/**
 * Answer the public bootstrap without evaluating SDK content.
 * @param url - Requested synthetic URL.
 * @param corruptSdk - Whether the SDK fails its test-only digest.
 * @returns Synthetic response, or false for a non-bootstrap route.
 */
function answerBootstrap(url: URL, corruptSdk = false): Response | false {
  const query = 'trackingCode=fresh-route&sysNum=23&langNum=1';
  if (url.pathname === '/H/Login.html') {
    return new Response(null, {
      status: 302,
      headers: { location: `${url.origin}${GATE}?${query}` },
    });
  }
  if (url.pathname === SDK) {
    return new Response(corruptSdk ? 'drifted SDK bytes' : SYNTHETIC_SDK, {
      headers: { 'content-type': 'application/javascript' },
    });
  }
  if (url.pathname === GATE || url.pathname === `${GATE}he/`) {
    return new Response(`<script src="${SDK}"></script>`, {
      headers: { 'content-type': 'text/html' },
    });
  }
  if (url.pathname === '/vdesk/hangup.php3') return new Response('');
  return false;
}

/**
 * Answer the fixed synthetic portal routes.
 * @param path - Request pathname.
 * @returns Synthetic response, or false for a non-portal route.
 */
function answerPortal(path: string): Response | false {
  const json = JSON.stringify({ SessionID: SPA_SESSION });
  const state = JSON.stringify(json);
  const answers = new Map<string, () => Response>([
    ['/sentinel', (): Response => Response.json({})],
    [
      '/authenticate',
      (): Response =>
        new Response(JSON.stringify({ LandingPage: '/eBanking/SSOLogin.aspx' }), {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
    ],
    [
      '/Ebanking/SSOLogin.aspx',
      (): Response => new Response('', { headers: { LandingPage: '/eBanking/SO/SPA.aspx' } }),
    ],
    [
      '/eBanking/SO/SPA.aspx',
      (): Response =>
        new Response(`<script>window.state=${state};</script>`, {
          headers: { 'content-type': 'text/html' },
        }),
    ],
  ]);
  const answer = answers.get(path);
  return answer === undefined ? false : answer();
}

/**
 * Decode the synthetic WCF request.
 * @param init - Native fetch options.
 * @returns Request envelope and inner object.
 */
function readRequest(init: RequestInit): IWcfRequest {
  if (typeof init.body !== 'string') throw new TypeError('synthetic WCF body missing');
  const body = JSON.parse(init.body) as JsonUnknownRecord;
  if (typeof body.reqObj !== 'string') throw new TypeError('synthetic WCF inner missing');
  const inner = JSON.parse(body.reqObj) as JsonUnknownRecord;
  return { moduleName: body.moduleName, inner };
}

/**
 * Select the request's operation.
 * @param request - Decoded synthetic request.
 * @returns Operation name.
 */
function stageOf(request: IWcfRequest): WcfStage {
  if (request.moduleName === 'UC_SO_GetAccounts') return 'customer';
  if (request.moduleName !== 'UC_SO_27_GetBusinessAccountTrx')
    throw new TypeError('unexpected synthetic WCF module');
  return request.inner.RequestType === '' ? 'balance' : 'transactions';
}

/** Successful inner responses for the three operations. */
const ANSWERS: Readonly<Record<WcfStage, object>> = {
  customer: { AccountsItems: [ACCOUNT] },
  balance: { SOStatus: STATUS, BalanceDisplay: 7 },
  transactions: { SOStatus: STATUS, HistoryTransactionsItems: ROWS },
};

/**
 * Reply to one WCF request and retain its synthetic wire arguments.
 * @param init - Native fetch options.
 * @param requests - Recorded synthetic requests.
 * @param failAt - Optional invalid operation response.
 * @returns Synthetic WCF response.
 */
function answerWcf(init: RequestInit, requests: IWcfRequest[], failAt?: WcfStage): Response {
  const request = readRequest(init);
  requests.push(request);
  const stage = stageOf(request);
  const inner = stage === failAt ? { privateMarker: 'synthetic-private-marker' } : ANSWERS[stage];
  return Response.json({ ProcessRequestResult: 0, jsonResp: JSON.stringify(inner) });
}

/**
 * Run the real Leumi financial action and its post-scrape result guard.
 * @param bus - Native mediator retaining the synthetic session.
 * @returns Scrape procedure after validation.
 */
async function scrapeWcf(bus: IApiMediator): Promise<Procedure<IPipelineContext>> {
  const base = makeMockContext({ apiMediator: some(bus), companyId: CompanyTypes.Leumi });
  const options = { ...base.options, startDate: new Date('2026-01-01') };
  const ctx = { ...base, options, executor: none(), windowEnd: none() };
  const action = await createApiDirectScrapePhase(LEUMI_SHAPE)(ctx);
  if (!action.success) return action;
  const updated = { ...ctx, scrape: action.value.scrape };
  return buildApiDirectScrapePhase(LEUMI_SHAPE).post(ctx, updated);
}

export { answerBootstrap, answerPortal, answerWcf, scrapeWcf, SYNTHETIC_SDK };
export type { IWcfRequest, WcfStage };
