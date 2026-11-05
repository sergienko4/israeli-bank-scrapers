/**
 * Yahav mocked BaNCS routes (spec §10.2 rows 4–7, §10.3): the login opens a
 * session, the reads after it rotate the session id, XSRF, CSRF and security
 * token (the customer answer rotates nothing and sends both ids empty, the
 * portfolio answer rotates nothing and sends no ids), and every read must
 * echo the latest generation over the device certificate, the bearer token,
 * the device handle, a fresh body digest and the BaNCS cookie alone.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 */

import { createHash } from 'node:crypto';

import { getIn } from '../../../Scrapers/Pipeline/Mediator/Scrape/Bancs/BancsShape.js';
import {
  YAHAV_BANCS_PATHS as PATHS,
  YAHAV_BODY_DIGEST,
  YAHAV_ENVELOPE_VER,
  YAHAV_NATIVE_UA,
} from '../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigYahavConstants.js';
import type { JsonUnknownRecord } from '../../../Scrapers/Pipeline/Types/JsonValue.js';
import type { IRecordedCall } from '../Helpers/FetchMockKit.js';
import { errorReply, parseBody } from '../Helpers/FetchMockKit.js';
import { json } from '../Helpers/MockReplies.js';
import { isIssued } from './YahavAuthRoutes.js';
import type { IBancsDay, IBancsWindow } from './YahavBancsData.js';
import {
  accountEntities,
  balanceEntities,
  iorOf,
  isoDayOf,
  portfolioEntities,
  txnRows,
} from './YahavBancsData.js';
import type { BancsCall, IYahavMockState, Route, RouteReply } from './YahavFaults.js';
import { checkWire, headerChecks, hit } from './YahavFaults.js';
import {
  bancsStateAt,
  YAHAV_MOCK_CREDS,
  YH_ACCESS_TOKEN,
  YH_ACCOUNTS,
  YH_BANCS_COOKIE,
  YH_CLIENT_SECRET,
  YH_MAG,
  YH_ORIGIN,
  YH_PORTFOLIO,
  YH_USER,
} from './YahavMockData.js';

type Checks = Record<string, boolean>;
type Entities = readonly JsonUnknownRecord[];

const PATH_CALLS: Readonly<Record<string, BancsCall>> = {
  [PATHS.login]: 'login',
  [PATHS.customer]: 'customer',
  [PATHS.portfolio]: 'portfolio',
};

/** `/account` serves three reads, told apart by the entity they ask for. */
const ACCOUNT_CALLS: Readonly<Record<string, BancsCall>> = {
  'PortfolioAccountRelationship_1.0.0': 'accounts',
  'DemandDepositAccount_1.0.0': 'balance',
  'Transaction_1.0.0': 'txns',
};

/** Reads that name the default portfolio by reference. */
const PORTFOLIO_READS: ReadonlySet<BancsCall> = new Set(['accounts', 'balance', 'txns']);

const EMPTY_SECTOKEN = { Ver: 'SecurityToken_1.0.0', isArchetype: false, Token: [] };

/** The ids the bank's customer answer sends: present and empty ("no update"). */
const NO_UPDATE_IDS = { jesessionid: '', 'xsrf-token': '' };

/** Texts no BaNCS call may carry: credentials, the client secret, any certificate. */
const SECRETS = [YAHAV_MOCK_CREDS.password, YH_CLIENT_SECRET, YH_USER, 'Basic ', '-----BEGIN'];

/**
 * Which BaNCS call a request is.
 * @param call - The request.
 * @returns The call, or false for an unknown one.
 */
export function bancsCallOf(call: IRecordedCall): BancsCall | false {
  const { pathname } = new URL(call.url);
  if (pathname !== PATHS.account) return PATH_CALLS[pathname] ?? false;
  const body = parseBody(call.body);
  const entity = getIn(body, ['Payload', 'DataEntity', '0', 'Ver']);
  return ACCOUNT_CALLS[String(entity)] ?? false;
}

/**
 * Whether two JSON values are the same.
 * @param left - One value.
 * @param right - The other.
 * @returns True when they serialize alike.
 */
function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * The digest header the app derives from the exact body bytes.
 * @param body - The body sent.
 * @returns base64 of the prefix and the body's SHA-256 hex.
 */
function digestOf(body: string): string {
  const hex = createHash('sha256').update(body, 'utf8').digest('hex');
  return Buffer.from(`${YAHAV_BODY_DIGEST.prefix}${hex}`).toString('base64');
}

/**
 * Whether a call carries any secret in its headers or body.
 * @param call - The request.
 * @returns True when a secret leaked.
 */
function hasSecret(call: IRecordedCall): boolean {
  const text = `${[...call.headers.values()].join('\n')}\n${call.body}`;
  return SECRETS.some(secret => text.includes(secret));
}

/**
 * The checks every BaNCS call must pass.
 * @param call - The request.
 * @param body - Its parsed body.
 * @param state - Run state.
 * @returns Check name → whether it held.
 */
function commonChecks(
  call: IRecordedCall,
  body: JsonUnknownRecord,
  state: IYahavMockState,
): Checks {
  const { pathname } = new URL(call.url);
  const fixed = { 'content-type': 'application/json; charset=UTF-8', accept: 'application/json' };
  const app = { 'user-agent': YAHAV_NATIVE_UA, request_path: pathname, 'mag-identifier': YH_MAG };
  const auth = { authorization: `Bearer ${YH_ACCESS_TOKEN}`, bd_ident_key: digestOf(call.body) };
  const isEnvelope = body.Ver === YAHAV_ENVELOPE_VER && body.Resource === `${YH_ORIGIN}${pathname}`;
  const isClean = !hasSecret(call);
  return {
    ...headerChecks(call, { ...fixed, ...app, ...auth }),
    isEnvelope,
    isClean,
    isIssued: isIssued(state.presented),
  };
}

/**
 * The checks the login must pass: no session yet, no cookie.
 * @param call - The request.
 * @param body - Its parsed body.
 * @returns Check name → whether it held.
 */
function loginChecks(call: IRecordedCall, body: JsonUnknownRecord): Checks {
  const isBlank = same(body.SecToken, EMPTY_SECTOKEN) && !('csrfTkn' in body);
  const isValidate = getIn(body, ['Payload', 'Operation']) === 'VLD';
  const isCookieless = call.headers.get('cookie') === null;
  return {
    ...headerChecks(call, { jesessionid: '', 'x-xsrf-token': '' }),
    isBlank,
    isValidate,
    isCookieless,
  };
}

/**
 * The checks a read must pass: the latest session, the BaNCS cookie alone.
 * @param call - The request.
 * @param body - Its parsed body.
 * @param state - Run state.
 * @returns Check name → whether it held.
 */
function readChecks(call: IRecordedCall, body: JsonUnknownRecord, state: IYahavMockState): Checks {
  const held = bancsStateAt(state.generation);
  const ids = { jesessionid: held.session, 'x-xsrf-token': held.xsrf, cookie: YH_BANCS_COOKIE };
  const isEchoed = body.csrfTkn === held.csrf && same(body.SecToken, held.security);
  const isInquiry = getIn(body, ['Payload', 'Operation']) === 'INQ';
  return { ...headerChecks(call, ids), isOpen: state.generation > 0, isEchoed, isInquiry };
}

/**
 * Whether a read names the default portfolio and, if any, a listed account.
 * @param body - The parsed body.
 * @returns True when every reference is one the bank handed out.
 */
function isKnownRef(body: JsonUnknownRecord): boolean {
  const portfolio = getIn(body, ['Payload', 'RefDataList', '0', 'Id']);
  const account = getIn(body, ['Payload', 'DataEntity', '0', 'AccountId']);
  if (portfolio !== YH_PORTFOLIO.iorId) return false;
  if (account === undefined) return true;
  const id = getIn(body, ['Payload', 'DataEntity', '0', 'AccountId', 'Id', 'Id']);
  const iorId = getIn(body, ['Payload', 'DataEntity', '0', 'AccountId', 'iorId']);
  return YH_ACCOUNTS.some(listed => listed.id === id && iorOf(listed.id) === iorId);
}

/**
 * The checks a call must pass.
 * @param call - The request.
 * @param kind - Which BaNCS call it is.
 * @param state - Run state.
 * @returns Check name → whether it held.
 */
function bancsChecks(call: IRecordedCall, kind: BancsCall, state: IYahavMockState): Checks {
  const body = parseBody(call.body);
  const own = kind === 'login' ? loginChecks(call, body) : readChecks(call, body, state);
  const refs: Checks = PORTFOLIO_READS.has(kind) ? { isKnownRef: isKnownRef(body) } : {};
  return { ...commonChecks(call, body, state), ...own, ...refs };
}

/**
 * The window a transactions call asks for.
 * @param call - The request.
 * @returns Its inclusive days, or an empty window when off spec.
 */
export function windowOf(call: IRecordedCall): IBancsWindow {
  const body = parseBody(call.body);
  const filters = getIn(body, ['Payload', 'Filters', '0', 'Filters']);
  if (!Array.isArray(filters) || filters.length !== 2) return { from: '9', to: '0' };
  const [from, to] = filters as readonly { OrigDt: IBancsDay; Operator: string }[];
  const isOrdered = from.Operator === 'GREATERTHANOREQUAL' && to.Operator === 'LESSTHANOREQUAL';
  if (!isOrdered) return { from: '9', to: '0' };
  return { from: isoDayOf(from.OrigDt), to: isoDayOf(to.OrigDt) };
}

/** What an answer without entities carries in their place, as the bank sends it. */
const NO_ENTITIES = { EntityCounts: [] };

/**
 * An answer body; an empty one leaves the entity list out, as the bank does.
 * @param state - Run state.
 * @param entities - The answer's entities.
 * @param session - Session fields the answer carries.
 * @returns The envelope.
 */
function answerOf(
  state: IYahavMockState,
  entities: Entities,
  session: JsonUnknownRecord,
): JsonUnknownRecord {
  const code = state.fault === 'statusText0' ? '0' : 0;
  const listed = entities.length > 0 ? { DataEntity: [...entities] } : NO_ENTITIES;
  const payload = { Ver: 'MessagePayload_1.0.0', ...listed };
  return { Ver: YAHAV_ENVELOPE_VER, Status: { Code: code }, ...session, Payload: payload };
}

/**
 * An answer that opens or rotates the session.
 * @param state - Run state; its generation advances.
 * @param entities - The answer's entities.
 * @returns The rotated answer.
 */
function rotated(state: IYahavMockState, entities: Entities): Response {
  state.generation += 1;
  const next = bancsStateAt(state.generation);
  const csrf =
    state.fault === 'noLoginCsrf' && state.generation === 1 ? {} : { csrfTkn: next.csrf };
  const session = { ...csrf, SecToken: next.security };
  const headers = {
    jesessionid: `JSESSIONID=${next.session}; Path=/`,
    'xsrf-token': `XSRF-TOKEN=${next.xsrf}; Path=/`,
  };
  const body = answerOf(state, entities, session);
  return json(body, { headers });
}

/**
 * An answer that rotates nothing: blank CSRF, empty token, and the given ids.
 * @param state - Run state; its generation stays.
 * @param entities - The answer's entities.
 * @param headers - The session headers it sends, if any.
 * @returns The answer.
 */
function unrotated(
  state: IYahavMockState,
  entities: Entities,
  headers: Readonly<Record<string, string>> = {},
): Response {
  const body = answerOf(state, entities, { csrfTkn: '', SecToken: EMPTY_SECTOKEN });
  return json(body, { headers });
}

const ANSWERS: Readonly<Record<BancsCall, Route>> = {
  /**
   * Open a session; set the BaNCS cookie.
   * @param _call - The request.
   * @param state - Run state; the generation restarts.
   * @returns The opened session.
   */
  login: (_call, state) => {
    state.generation = 0;
    const answer = rotated(state, [{ Ver: 'LoginUserCredentials_1.0.0' }]);
    answer.headers.append(
      'set-cookie',
      `${YH_BANCS_COOKIE}; Path=/BaNCSDigitalApp; Secure; HttpOnly`,
    );
    return answer;
  },
  /**
   * The customer, rotating nothing and sending both ids empty as the bank
   * does; a refusal under `bankStatus`.
   * @param _call - The request.
   * @param state - Run state.
   * @returns The customer.
   */
  customer: (_call, state) => {
    const entities = [{ Ver: 'CustomerUser_1.0.0' }];
    if (state.fault !== 'bankStatus') return unrotated(state, entities, NO_UPDATE_IDS);
    return json({
      Ver: YAHAV_ENVELOPE_VER,
      Status: { Code: 'E1001' },
      Payload: { DataEntity: [] },
    });
  },
  /**
   * The portfolios, rotating nothing: blank CSRF, empty token, no ids.
   * @param _call - The request.
   * @param state - Run state.
   * @returns The portfolios.
   */
  portfolio: (_call, state) => {
    const entities = portfolioEntities();
    return unrotated(state, entities);
  },
  /**
   * The default portfolio's accounts.
   * @param _call - The request.
   * @param state - Run state.
   * @returns The accounts.
   */
  accounts: (_call, state) => {
    const entities = accountEntities();
    return rotated(state, entities);
  },
  /**
   * Every account's balance.
   * @param _call - The request.
   * @param state - Run state.
   * @returns The balances.
   */
  balance: (_call, state) => {
    const entities = balanceEntities();
    return rotated(state, entities);
  },
  /**
   * Every account's movements in the asked window.
   * @param call - The request.
   * @param state - Run state.
   * @returns The movements.
   */
  txns: (call, state) => {
    const window = windowOf(call);
    const rows = txnRows(window);
    return rotated(state, rows);
  },
};

/**
 * Whether the run's fault refuses this call.
 * @param state - Run state.
 * @param kind - Which call.
 * @param count - How many times it has been hit, this one included.
 * @returns True to answer 401.
 */
function isRejected(state: IYahavMockState, kind: BancsCall, count: number): boolean {
  if (state.fault === 'rejectAlways') return kind === 'login';
  if (state.fault === 'recoveryToken401') return kind === 'login' && count === 1;
  return state.fault === `reject:${kind}` && count === 1;
}

/**
 * Answer a BaNCS call: refuse it under the run's fault, check it, answer it.
 * @param call - The request.
 * @param state - Run state.
 * @returns The answer; 401 when refused; 400 when off spec; 404 when unknown.
 */
function routeBancs(call: IRecordedCall, state: IYahavMockState): RouteReply {
  const kind = bancsCallOf(call);
  if (kind === false) return errorReply(404);
  const count = hit(state, kind);
  if (state.fault === 'customer500' && kind === 'customer') return errorReply(500);
  if (isRejected(state, kind, count)) return errorReply(401);
  const checks = bancsChecks(call, kind, state);
  if (!checkWire(state, call, checks)) return errorReply(400);
  return ANSWERS[kind](call, state);
}

const BANCS_PATH_ROUTES = Object.values(PATHS).map((path): readonly [string, Route] => [
  `POST ${path}`,
  routeBancs,
]);

export const BANCS_ROUTES: Readonly<Record<string, Route>> = Object.fromEntries(BANCS_PATH_ROUTES);
