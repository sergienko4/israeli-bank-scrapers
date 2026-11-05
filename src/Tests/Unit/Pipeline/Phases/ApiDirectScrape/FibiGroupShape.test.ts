/**
 * FIBI group family shape — per-call financial headers, proved once over
 * the four brand shapes `makeFibiGroupShape` builds.
 *
 * Every financial call (userData, accountType, balances, transactions
 * list) sends a fresh `X-FIBI-Transaction-Id` and, when the session holds
 * one, the portal-shell `authorization` value verbatim as `Authorization`.
 * The transactions list returns the whole date range in one answer, so a
 * page of more than 50 rows must come back whole. Values are synthetic.
 */

import { jest } from '@jest/globals';

import BEINLEUMI_SHAPE from '../../../../../Scrapers/Pipeline/Banks/Beinleumi/scrape/BeinleumiShape.js';
import MASSAD_SHAPE from '../../../../../Scrapers/Pipeline/Banks/Massad/scrape/MassadShape.js';
import OTSAR_HAHAYAL_SHAPE from '../../../../../Scrapers/Pipeline/Banks/OtsarHahayal/scrape/OtsarHahayalShape.js';
import PAGI_SHAPE from '../../../../../Scrapers/Pipeline/Banks/Pagi/scrape/PagiShape.js';
import type { IApiQueryOpts } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type { IDriverCtx } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapeDispatchArgs.js';
import { fetchAccounts } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapeSteps.js';
import type { IFibiAcct } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/FibiGroup/FibiGroupShapeHelpers.js';
import type {
  ApiBody,
  ApiDirectScrapeHeadersLike,
  HeaderMap,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { mergeUnder } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/DefaultHeadersFetchStrategy.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { isOk, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

type FibiShape = typeof BEINLEUMI_SHAPE;
type StepName = 'customer' | 'balance' | 'transactions';
type Session = Record<string, unknown>;
type IdentityAnswer = Promise<Procedure<ApiBody>>;
type IdentityGetArgs = [url: string, opts: IApiQueryOpts];

interface IBrand {
  readonly name: string;
  readonly shape: FibiShape;
}

const BRANDS: readonly IBrand[] = [
  { name: 'Beinleumi', shape: BEINLEUMI_SHAPE },
  { name: 'Massad', shape: MASSAD_SHAPE },
  { name: 'OtsarHahayal', shape: OTSAR_HAHAYAL_SHAPE },
  { name: 'Pagi', shape: PAGI_SHAPE },
];

const STEPS: readonly StepName[] = ['customer', 'balance', 'transactions'];
const TXN_ID = 'X-FIBI-Transaction-Id';
const UUID_V4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u;
/** Synthetic value with inner spaces and dots — must reach the wire unchanged. */
const AUTH = 'Bearer synthetic.portal-shell token';
const ACCT: IFibiAcct = { accountNumber: '555001', branch: '770', accountType: 105 };
const USER_DATA: ApiBody = { accounts: [{ account: '555001', branch: '770', selected: true }] };
const ACCOUNT_TYPE: ApiBody = { accountType: [{ accountType: 105 }] };

/**
 * Action context whose API mediator holds the given session context.
 * @param session - Post-login session context.
 * @returns Action context.
 */
function sessionCtx(session: Session): IActionContext {
  /**
   * Session context stand-in.
   * @returns The given session.
   */
  const getSessionContext = (): Session => session;
  return { apiMediator: some({ getSessionContext }) } as unknown as IActionContext;
}

/**
 * Resolve a step's headers the way the driver does, per call.
 * @param spec - The step's declared headers.
 * @param ctx - Action context.
 * @returns Headers for one call.
 */
function headersOf(spec: ApiDirectScrapeHeadersLike, ctx: IActionContext): HeaderMap {
  if (typeof spec === 'function') return spec(ctx);
  return spec;
}

/**
 * Headers one call of a brand step sends.
 * @param brand - Brand under test.
 * @param step - Step name.
 * @param ctx - Action context.
 * @returns Header map.
 */
function stepHeaders(brand: IBrand, step: StepName, ctx: IActionContext): HeaderMap {
  const spec = brand.shape[step].extraHeaders ?? {};
  return headersOf(spec, ctx);
}

/** Session contexts that hold no usable authorization value. */
const NO_AUTH_CASES: readonly (readonly [string, IActionContext])[] = [
  ['no API mediator', { apiMediator: none() } as unknown as IActionContext],
  ['no authorization slot', sessionCtx({})],
  ['an empty authorization', sessionCtx({ authorization: '' })],
  ['a non-text authorization', sessionCtx({ authorization: 42 })],
];

describe.each(BRANDS)('$name FIBI financial headers', brand => {
  it.each(STEPS)('sends a fresh transaction id on every %s call', step => {
    const ctx = sessionCtx({ authorization: AUTH });
    const first = stepHeaders(brand, step, ctx);
    const second = stepHeaders(brand, step, ctx);
    expect(first[TXN_ID]).toMatch(UUID_V4);
    expect(second[TXN_ID]).toMatch(UUID_V4);
    expect(second[TXN_ID]).not.toBe(first[TXN_ID]);
  });

  it.each(STEPS)('sends the session authorization verbatim on the %s call', step => {
    const ctx = sessionCtx({ authorization: AUTH });
    const headers = stepHeaders(brand, step, ctx);
    expect(headers.Authorization).toBe(AUTH);
  });

  it.each(NO_AUTH_CASES)('sends no Authorization with %s', (_label, ctx) => {
    const headers = stepHeaders(brand, 'transactions', ctx);
    const names = Object.keys(headers);
    expect(names).toEqual([TXN_ID]);
  });

  it('returns every row of a full-window page longer than 50 rows', () => {
    const rows = Array.from({ length: 73 }, (_v, i): object => ({ debitAmount: i }));
    const ctx = sessionCtx({});
    const args = { body: { transactions: rows }, cursor: false as const, acct: ACCT, ctx };
    const page = brand.shape.transactions.extractPage(args);
    expect(page.items).toHaveLength(73);
    expect(page.nextCursor).toBe(false);
  });
});

/**
 * Bus whose GETs answer userData or accountType by URL.
 * @param session - Session context the bus holds.
 * @returns Bus stand-in with a spy-able apiGet.
 */
function identityBus(session: Session): {
  apiGet: jest.Mock<IdentityAnswer, IdentityGetArgs>;
  getSessionContext: () => Session;
} {
  const apiGet = jest.fn<IdentityAnswer, IdentityGetArgs>((url: string): IdentityAnswer => {
    const body = url.includes('/accountType') ? ACCOUNT_TYPE : USER_DATA;
    const answer = succeed(body);
    return Promise.resolve(answer);
  });
  /**
   * Session context stand-in.
   * @returns The given session.
   */
  const getSessionContext = (): Session => session;
  return { apiGet, getSessionContext };
}

describe('FIBI identity GETs through the driver', () => {
  it('sends its own transaction id and the authorization on userData and accountType', async () => {
    const session = { authorization: AUTH };
    const bus = identityBus(session);
    const ctx = sessionCtx(session);
    const d = { shape: BEINLEUMI_SHAPE, bus, ctx } as unknown as IDriverCtx<IFibiAcct, never>;
    const result = await fetchAccounts(d);
    const isFetched = isOk(result);
    expect(isFetched).toBe(true);
    const sent = bus.apiGet.mock.calls.map((call): HeaderMap => call[1].extraHeaders ?? {});
    expect(sent).toHaveLength(2);
    expect(sent[0].Authorization).toBe(AUTH);
    expect(sent[1].Authorization).toBe(AUTH);
    expect(sent[1][TXN_ID]).toMatch(UUID_V4);
    expect(sent[1][TXN_ID]).not.toBe(sent[0][TXN_ID]);
  });
});

it('replaces a browser-captured lower-case transaction id with a fresh one', () => {
  const ctx = sessionCtx({});
  const headers = stepHeaders(BRANDS[0], 'transactions', ctx);
  const defaults = { 'x-fibi-transaction-id': 'syn-captured-id' };
  const opts = mergeUnder(defaults, { extraHeaders: headers });
  const ids = Object.entries(opts.extraHeaders).filter(
    ([name]) => name.toLowerCase() === TXN_ID.toLowerCase(),
  );
  expect(ids).toEqual([[TXN_ID, headers[TXN_ID]]]);
  expect(ids[0][1]).toMatch(UUID_V4);
});
