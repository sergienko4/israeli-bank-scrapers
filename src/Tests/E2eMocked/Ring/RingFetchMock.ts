/**
 * Ring synthetic fetch mock — stands in for a card issuer's mobile "ring"
 * gateway so the HTTP-only login and scrape run with no network. One mock
 * serves every ring issuer; an {@link IRingTarget} names the issuer.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 *
 * Every call is `POST <base>/service?serviceName=<S>&applicationId=<app>`,
 * except transactions, which post to `<base>/GatewayV2`.
 * Login services, counted as `identity`:
 *   ValidateIdDataNoReg        id + card6 → opens a session, issues bcKey + userName
 *   performNewLogon            the password, on the validated session
 *   CustomerValidateKeyOtp/9   issues a device key to the logged-on session
 *   CustomerDataRegistration   binds that key to the device's UDID
 *   CustomerValidateKeyOtp/4   resumes a registered key + UDID; opens a session when none
 *   performLogonOtp            authenticates the session
 * Data calls, counted as `graphql` (the shared handle contract):
 *   CardsList_102Digital       the cards
 *   GatewayV2                  a card's rows and statement total for one billing month
 *
 * The mock enforces what the ring enforces, so a broken request fails here
 * too: the session rides on a cookie, every call on a session carries that
 * session's bcKey header, a key resumes only with the UDID it was registered
 * with, and a data call without an authenticated session answers as the live
 * ring does — CardsList with `Header.Status '-2'`, GatewayV2 with a non-JSON 500.
 */

import { bankMomentOfInstant } from '../../../Scrapers/Pipeline/Mediator/Scrape/BankCalendar.js';
import type { JsonUnknownRecord } from '../../../Scrapers/Pipeline/Types/JsonValue.js';
import type {
  CallKind,
  IMockHandle,
  IRecordedCall,
  NetworkFault,
} from '../Helpers/FetchMockKit.js';
import {
  errorReply,
  installFetchMock,
  jsonReply,
  NETWORK_FAULTS,
  parseBody,
} from '../Helpers/FetchMockKit.js';

/** The issuer a mock instance plays. */
export interface IRingTarget {
  readonly base: string;
  readonly applicationId: string;
  readonly isrdomain: string;
  readonly companyCode: string;
}

/** Isracard's ring. */
export const ISRACARD_RING_TARGET: IRingTarget = {
  base: 'https://ring.isracard.co.il',
  applicationId: 'mi',
  isrdomain: 'isracard',
  companyCode: '11',
};

/** Amex's ring. */
export const AMEX_RING_TARGET: IRingTarget = {
  base: 'https://ring.americanexpress.co.il',
  applicationId: 'ma',
  isrdomain: 'amex',
  companyCode: '77',
};

/**
 * A fault the ring answers with instead of its normal reply: a transport
 * fault on step 0, a password the ring wants changed (validate code '4' or
 * logon status '3'), one expired-session answer on the first card list, a
 * card list with one row that has no card number, or a GatewayV2 that
 * refuses every month inside an HTTP 200 (`isSuccess: false`).
 */
export type RingFault =
  | 'none'
  | NetworkFault
  | 'changePassword'
  | 'passwordExpired'
  | 'expireOnce'
  | 'unnamedCard'
  | 'refuseMonth';

/**
 * Synthetic credentials for mock-mode runs — safe for public fixtures. The
 * id fails the Israeli ID check digit, so it can never name a real person.
 */
export const RING_MOCK_CREDS = Object.freeze({
  id: '000000019',
  card6Digits: '123456',
  password: 'synthetic-ring-pass',
});

/**
 * The UDID a device derives from {@link RING_MOCK_CREDS}' id. A stored key
 * resumes only with it, so a run that derived another would orphan every
 * key users already hold.
 */
export const SYN_DEVICE_UDID = 'dbbfee49579444a8';

/** A key registered on an earlier run — the warm-start seed. */
export const SYN_STORED_KEY = 'syn-ring-stored-key-7c2e';

/** The key a cold login has the ring issue and register. */
export const SYN_ISSUED_KEY = 'syn-ring-issued-key-3d9a';

/** The stem of every session's bcKey. */
const SYN_BC_KEY = 'syn-ring-bckey-6f1b';

/**
 * The bcKey the ring hands its nth session; later calls on that session
 * must echo it. Each session gets its own, so a call that keeps an earlier
 * session's key after a re-login fails here as it does on the live ring.
 * @param sessionNumber - 1 for the first session the ring opens.
 * @returns That session's bcKey.
 */
export function ringBcKey(sessionNumber: number): string {
  return `${SYN_BC_KEY}-${String(sessionNumber)}`;
}

const SYN_USER_NAME = 'syn-ring-user';
const SESSION_COOKIE = 'RingSession';
const WALLET_ID = '216';
const TXNS_SERVICE_URL = '11/v3-transactions/v1.1.0/GetTransactionsList';

/** One synthetic card: its rows and the statement total it reports. */
interface IRingSynCard {
  readonly last4: string;
  readonly amounts: readonly number[];
  readonly statementTotal: number;
}

/** Two cards with different totals, so per-card balance attribution is observable. */
export const RING_MOCK_CARDS: readonly IRingSynCard[] = [
  { last4: '4321', amounts: [51, 129.9], statementTotal: 180.9 },
  { last4: '8765', amounts: [310], statementTotal: 310 },
];

/** The last possible payment day: today is never past it, so the next debit is this month. */
const PAYMENT_DAY = '31';

const BANK_TODAY = bankMomentOfInstant(new Date());

/** The billing month the rows and statement totals belong to. */
const DEBIT_MONTH = `01/${BANK_TODAY.format('MM/YYYY')}`;

/** Purchases sit two days back so they are always inside the window. */
const PURCHASE_DATE = BANK_TODAY.clone().subtract(2, 'days').format('DD/MM/YYYY');

/** Opens the scrape window two months back, before every synthetic row. */
export const RING_MOCK_START_DATE = BANK_TODAY.clone()
  .subtract(2, 'months')
  .startOf('month')
  .toDate();

/**
 * Fields every synthetic row shares; ids and amounts vary per row. As on the
 * live ring, `originalCurrency` is a numeric code and the ISO text sits beside it.
 */
const BASE_ROW = Object.freeze({
  purchaseDate: PURCHASE_DATE,
  originalCurrency: 0,
  originalCurrencyIso: 'ILS',
  billingAmountCurrency: 0,
  currentInstallmentNum: 0,
  numberOfInstallment: 0,
  moreInfo: '',
});

/** One ring session, as the server tracks it. */
interface IRingSession {
  readonly bcKey: string;
  isLoggedOn: boolean;
  pendingKey: string;
  pendingUdid: string;
  isKeyVerified: boolean;
  isAuthenticated: boolean;
}

/** A session just opened, with the cookie that names it. */
interface IOpenedSession<TSession = IRingSession | false> {
  readonly session: TSession;
  /** Set-Cookie line for the reply; empty when no session was opened. */
  readonly cookie: string;
}

/** Everything one installed mock remembers between calls. */
interface IRingState {
  readonly target: IRingTarget;
  readonly fault: RingFault;
  readonly sessions: Map<string, IRingSession>;
  /** Registered device keys, each bound to the UDID that registered it. */
  readonly devices: Map<string, string>;
  isExpiryPending: boolean;
}

/** One call as a route handler sees it. */
interface IRingRequest {
  readonly state: IRingState;
  readonly call: IRecordedCall;
  readonly body: JsonUnknownRecord;
  /** The session the call's cookie names; false when it names none. */
  readonly session: IRingSession | false;
}

/**
 * The route a ring call names: its service, the key-check level, or GatewayV2.
 * @param call - A recorded call.
 * @returns e.g. `ValidateIdDataNoReg`, `CustomerValidateKeyOtp/9`, `GatewayV2`.
 */
export function ringStepOf(call: IRecordedCall): string {
  const url = new URL(call.url);
  if (url.pathname.endsWith('/GatewayV2')) return 'GatewayV2';
  const service = url.searchParams.get('serviceName') ?? '';
  if (service !== 'CustomerValidateKeyOtp') return service;
  const level = parseBody(call.body).checkLevel;
  return `${service}/${String(level)}`;
}

/**
 * The session a call's cookie names.
 * @param state - Mock state.
 * @param call - A recorded call.
 * @returns The session, or false when the cookie names none.
 */
function sessionOf(state: IRingState, call: IRecordedCall): IRingSession | false {
  const cookies = (call.headers.get('cookie') ?? '').split('; ');
  const pair = cookies.find(cookie => cookie.startsWith(`${SESSION_COOKIE}=`)) ?? '';
  const id = pair.slice(SESSION_COOKIE.length + 1);
  return state.sessions.get(id) ?? false;
}

/**
 * Open a fresh session.
 * @param state - Mock state, updated in place.
 * @returns The session and the Set-Cookie line that names it.
 */
function openSession(state: IRingState): IOpenedSession<IRingSession> {
  const sessionNumber = state.sessions.size + 1;
  const id = `syn-ring-session-${String(sessionNumber)}`;
  const session: IRingSession = {
    bcKey: ringBcKey(sessionNumber),
    isLoggedOn: false,
    pendingKey: '',
    pendingUdid: '',
    isKeyVerified: false,
    isAuthenticated: false,
  };
  state.sessions.set(id, session);
  return { session, cookie: `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; Secure` };
}

/**
 * The session a call rides on, when it also echoes that session's bcKey.
 * @param req - The request.
 * @returns The session, or false without one or with the wrong bcKey.
 */
function liveSession(req: IRingRequest): IRingSession | false {
  if (req.session === false) return false;
  const isEchoed = req.call.headers.get('bckey') === req.session.bcKey;
  return isEchoed ? req.session : false;
}

/**
 * Whether the request names the synthetic customer.
 * @param body - Parsed request body.
 * @param idField - Body field carrying the id.
 * @returns True for the synthetic id.
 */
function isCustomer(body: JsonUnknownRecord, idField: string): boolean {
  return body[idField] === RING_MOCK_CREDS.id;
}

/**
 * A ring answer carrying one bean.
 * @param bean - Bean name.
 * @param fields - Return code and any issued values.
 * @param cookie - Set-Cookie line to send with it; empty for none.
 * @returns The ring answer.
 */
function beanReply(bean: string, fields: JsonUnknownRecord, cookie = ''): Response {
  return jsonReply({ Header: { Status: '1' }, [bean]: fields }, cookie);
}

/**
 * Whether a validate body names the synthetic card at this issuer.
 * @param req - The request.
 * @returns True for the synthetic card suffix under the target's company code.
 */
function isIssuerCard(req: IRingRequest): boolean {
  const isCard = req.body.cardSuffix === RING_MOCK_CREDS.card6Digits;
  return isCard && req.body.companyCode === req.state.target.companyCode;
}

/**
 * ValidateIdDataNoReg — checks id + card6 at this issuer and opens a session.
 * @param req - The request.
 * @returns returnCode '1' with bcKey + userName; '2' for an unknown customer.
 */
function routeValidate(req: IRingRequest): Response {
  const bean = 'ValidateIdDataNoRegBean';
  const isKnown = isCustomer(req.body, 'id') && isIssuerCard(req);
  if (!isKnown) return beanReply(bean, { returnCode: '2' });
  if (req.state.fault === 'changePassword') return beanReply(bean, { returnCode: '4' });
  const { session, cookie } = openSession(req.state);
  const fields = { returnCode: '1', bcKey: session.bcKey, userName: SYN_USER_NAME };
  return beanReply(bean, fields, cookie);
}

/**
 * Whether a logon body carries the validated user, the password and the session's bcKey.
 * @param body - Parsed request body.
 * @param session - The validated session.
 * @returns True when every field matches.
 */
function isLogonBody(body: JsonUnknownRecord, session: IRingSession): boolean {
  const isUser = isCustomer(body, 'MisparZihuy') && body.KodMishtamesh === SYN_USER_NAME;
  const isPassword = body.Sisma === RING_MOCK_CREDS.password;
  return isUser && isPassword && body.bcKey === session.bcKey;
}

/**
 * performNewLogon — the password, on the validated session. Any refusal
 * other than '3' (password expired) reads as a wrong password.
 * @param req - The request.
 * @returns Header.Status '1' once logged on.
 */
function routeLogon(req: IRingRequest): Response {
  const session = liveSession(req);
  if (session === false) return jsonReply({ Header: { Status: '-2' } });
  if (!isLogonBody(req.body, session)) return jsonReply({ Header: { Status: '2' } });
  if (req.state.fault === 'passwordExpired') return jsonReply({ Header: { Status: '3' } });
  session.isLoggedOn = true;
  return jsonReply({ Header: { Status: '1' } });
}

/**
 * CustomerValidateKeyOtp level 9 — issues a device key to the logged-on session.
 * @param req - The request.
 * @returns returnCode '1' with the issued key.
 */
function routeDeviceKey(req: IRingRequest): Response {
  const bean = 'CustomerValidateKeyOtpBean';
  const session = liveSession(req);
  const isDevice = typeof req.body.UDID === 'string' && req.body.UDID !== '';
  const isAllowed = session !== false && session.isLoggedOn && isDevice;
  if (!isAllowed || !isCustomer(req.body, 'idNumber')) return beanReply(bean, { returnCode: '0' });
  session.pendingKey = SYN_ISSUED_KEY;
  session.pendingUdid = String(req.body.UDID);
  return beanReply(bean, { returnCode: '1', key: SYN_ISSUED_KEY });
}

/**
 * CustomerDataRegistration — binds the issued key to the device that asked for it.
 * @param req - The request.
 * @returns returnCode '1' once registered.
 */
function routeRegister(req: IRingRequest): Response {
  const bean = 'CustomerDataRegistrationBean';
  const session = liveSession(req);
  if (session === false || session.pendingKey === '') return beanReply(bean, { returnCode: '0' });
  const isPending = req.body.key === session.pendingKey && req.body.UDID === session.pendingUdid;
  if (!isPending || !isCustomer(req.body, 'idNumber')) return beanReply(bean, { returnCode: '0' });
  req.state.devices.set(session.pendingKey, session.pendingUdid);
  return beanReply(bean, { returnCode: '1' });
}

/**
 * Whether a resume body names a registered key from the device that registered it.
 * @param state - Mock state.
 * @param body - Parsed request body.
 * @returns True for a known key + UDID pair.
 */
function isRegisteredDevice(state: IRingState, body: JsonUnknownRecord): boolean {
  const key = String(body.key);
  const udid = state.devices.get(key);
  return udid !== undefined && udid === body.UDID;
}

/**
 * The session a resume continues, opening one when the call names none.
 * A new session only needs a seeded bcKey header; an existing one must echo its own.
 * @param req - The request.
 * @returns The session plus the Set-Cookie line, empty when it already existed.
 */
function resumeSession(req: IRingRequest): IOpenedSession {
  if (req.session !== false) return { session: liveSession(req), cookie: '' };
  const isSeeded = (req.call.headers.get('bckey') ?? '') !== '';
  if (!isSeeded) return { session: false, cookie: '' };
  return openSession(req.state);
}

/**
 * CustomerValidateKeyOtp level 4 — resumes a registered key.
 * @param req - The request.
 * @returns returnCode '1' with bcKey + userName; '0' for an unknown key.
 */
function routeResume(req: IRingRequest): Response {
  const bean = 'CustomerValidateKeyOtpBean';
  if (!isRegisteredDevice(req.state, req.body)) return beanReply(bean, { returnCode: '0' });
  const { session, cookie } = resumeSession(req);
  if (session === false) return beanReply(bean, { returnCode: '0' });
  session.isKeyVerified = true;
  const fields = { returnCode: '1', bcKey: session.bcKey, userName: SYN_USER_NAME };
  return beanReply(bean, fields, cookie);
}

/**
 * performLogonOtp — authenticates a session whose key was verified.
 * @param req - The request.
 * @returns CustomerLogonBean returnCode '1' once authenticated.
 */
function routeSessionToken(req: IRingRequest): Response {
  const bean = 'CustomerLogonBean';
  const session = liveSession(req);
  const isUser = isCustomer(req.body, 'MisparZihuy') && req.body.KodMishtamesh === SYN_USER_NAME;
  const isAllowed = session !== false && session.isKeyVerified && req.body.walletId === WALLET_ID;
  if (!isAllowed || !isUser) return beanReply(bean, { returnCode: '0' });
  session.isAuthenticated = true;
  return beanReply(bean, { returnCode: '1' });
}

/**
 * Whether a data call rides on an authenticated session.
 * @param req - The request.
 * @returns True when it does.
 */
function isAuthenticated(req: IRingRequest): boolean {
  const session = liveSession(req);
  return session !== false && session.isAuthenticated;
}

/**
 * Whether this card list must answer as an expired session, once.
 * @param state - Mock state, updated in place.
 * @returns True on the first card list under `expireOnce`.
 */
function consumeExpiry(state: IRingState): boolean {
  if (!state.isExpiryPending) return false;
  state.isExpiryPending = false;
  return true;
}

/** A card-list row with no card number — no card GatewayV2 could be asked about. */
const UNNAMED_CARD_ROW: JsonUnknownRecord = { cardNumber: null, paymentDate: PAYMENT_DAY };

/**
 * CardsList_102Digital — the cards.
 * @param req - The request.
 * @returns Both cards (plus an unnamed row under `unnamedCard`);
 * Header.Status '-2' without an authenticated session.
 */
function routeCards(req: IRingRequest): Response {
  const isListed = isAuthenticated(req) && req.body.walletId === WALLET_ID;
  if (!isListed || consumeExpiry(req.state)) return jsonReply({ Header: { Status: '-2' } });
  const cards = RING_MOCK_CARDS.map(card => ({
    cardNumber: card.last4,
    paymentDate: PAYMENT_DAY,
  }));
  const rows = req.state.fault === 'unnamedCard' ? [...cards, UNNAMED_CARD_ROW] : cards;
  return jsonReply({ Header: { Status: '1' }, CardsList_102DigitalBean: { Table1: rows } });
}

/**
 * One synthetic voucher row of a card.
 * @param card - Card the row belongs to.
 * @param amount - Charge amount.
 * @param index - Row position, used in the row's ids.
 * @returns A ring-shaped voucher row.
 */
function makeRow(card: IRingSynCard, amount: number, index: number): JsonUnknownRecord {
  const ordinal = String(index + 1);
  const voucherNumber = `${card.last4}00${ordinal}`;
  const businessName = `SYNTHETIC Merchant ${ordinal}`;
  const amounts = { ilsAmount: amount, billingAmount: amount, originalAmount: amount };
  return { ...BASE_ROW, voucherNumber, seqVoucherNumber: voucherNumber, businessName, ...amounts };
}

/**
 * A card's vouchers for its debit month.
 * @param card - The card.
 * @returns The rows and the statement total.
 */
function vouchersOf(card: IRingSynCard): JsonUnknownRecord {
  const israelAbroadVouchersList = card.amounts.map((amount, index) =>
    makeRow(card, amount, index),
  );
  const totalForStatement = { totalIlsBillingDate: card.statementTotal };
  return { vouchers: { israelAbroadVouchersList, totalForStatement } };
}

/**
 * A GatewayV2 transactions answer.
 * @param israelAbroadVouchers - The month's vouchers; an empty month has none.
 * @returns isSuccess true with the data.
 */
function gatewayReply(israelAbroadVouchers: JsonUnknownRecord): Response {
  const data = { approvals: { approvedTransactions: [] }, israelAbroadVouchers };
  return jsonReply({ isSuccess: true, errorCode: '0', data });
}

/**
 * The Data block of a GatewayV2 body that asks this issuer's transactions service.
 * @param state - Mock state.
 * @param body - Parsed request body.
 * @returns The Data block, or false for another service, issuer or card status.
 */
function gatewayData(state: IRingState, body: JsonUnknownRecord): JsonUnknownRecord | false {
  const data = (body.Data ?? {}) as JsonUnknownRecord;
  const isService = body.serviceUrl === TXNS_SERVICE_URL;
  const isIssuer = data.companyCode === Number(state.target.companyCode);
  return isService && isIssuer && data.cardStatus === 0 ? data : false;
}

/** A GatewayV2 refusal: the bank answers HTTP 200 but does not confirm the call. */
const REFUSED_MONTH: JsonUnknownRecord = { isSuccess: false, errorCode: '9', data: null };

/**
 * GatewayV2 — a card's rows and statement total, served for its debit month.
 * @param req - The request.
 * @returns The month's vouchers; a non-JSON 500 without an authenticated
 * session; a refusal under `refuseMonth`.
 */
function routeGateway(req: IRingRequest): Response {
  if (!isAuthenticated(req)) return errorReply(500);
  if (req.state.fault === 'refuseMonth') return jsonReply(REFUSED_MONTH);
  const data = gatewayData(req.state, req.body);
  if (data === false) return errorReply(400);
  const card = RING_MOCK_CARDS.find(known => known.last4 === data.card4Number);
  const isDebitMonth = card !== undefined && data.billingMonth === DEBIT_MONTH;
  return gatewayReply(isDebitMonth ? vouchersOf(card) : {});
}

/** Route handlers keyed by {@link ringStepOf}. */
const RING_ROUTES: Readonly<Record<string, (req: IRingRequest) => Response>> = {
  ValidateIdDataNoReg: routeValidate,
  performNewLogon: routeLogon,
  'CustomerValidateKeyOtp/9': routeDeviceKey,
  CustomerDataRegistration: routeRegister,
  'CustomerValidateKeyOtp/4': routeResume,
  performLogonOtp: routeSessionToken,
  CardsList_102Digital: routeCards,
  GatewayV2: routeGateway,
};

/** Routes counted as data calls; every other ring route is a login call. */
export const RING_DATA_STEPS: ReadonlySet<string> = new Set(['CardsList_102Digital', 'GatewayV2']);

/**
 * Whether a call carries the headers and query every ring call needs.
 * @param target - The issuer.
 * @param call - The recorded request.
 * @returns True for a JSON POST naming the issuer's domain and app.
 */
function isWellFormed(target: IRingTarget, call: IRecordedCall): boolean {
  const url = new URL(call.url);
  const isGateway = url.pathname.endsWith('/GatewayV2');
  const isApp = isGateway || url.searchParams.get('applicationId') === target.applicationId;
  const isJson = (call.headers.get('content-type') ?? '').startsWith('application/json');
  const isDomain = call.headers.get('isrdomain') === target.isrdomain;
  return call.method === 'POST' && isApp && isJson && isDomain;
}

/**
 * The transport fault step 0 answers with.
 * @param state - Mock state.
 * @param step - Route the call names.
 * @returns The fault, or false when the call is answered normally.
 */
function stepZeroFault(state: IRingState, step: string): NetworkFault | false {
  if (step !== 'ValidateIdDataNoReg') return false;
  return Object.hasOwn(NETWORK_FAULTS, state.fault) ? (state.fault as NetworkFault) : false;
}

/**
 * Route one ring call that is not a step-0 transport fault.
 * @param state - Mock state.
 * @param call - The recorded request.
 * @param step - Route the call names.
 * @returns The route's answer; a 400 for an unknown route or a malformed call.
 */
function routeRing(state: IRingState, call: IRecordedCall, step: string): Response {
  const isRouted = Object.hasOwn(RING_ROUTES, step) && isWellFormed(state.target, call);
  if (!isRouted) return errorReply(400);
  const body = parseBody(call.body);
  const session = sessionOf(state, call);
  return RING_ROUTES[step]({ state, call, body, session });
}

/**
 * Answer one ring call.
 * @param state - Mock state.
 * @param call - The recorded request.
 * @returns The ring's answer; rejects for a transport fault on step 0.
 */
function answerRing(state: IRingState, call: IRecordedCall): Promise<Response> {
  const step = ringStepOf(call);
  const fault = stepZeroFault(state, step);
  if (fault !== false) return NETWORK_FAULTS[fault]();
  const reply = routeRing(state, call, step);
  return Promise.resolve(reply);
}

/**
 * The tally a call counts toward.
 * @param target - The issuer.
 * @param call - The recorded request.
 * @returns `graphql` for card and transaction calls, `identity` for login calls.
 */
function classifyRing(target: IRingTarget, call: IRecordedCall): CallKind {
  if (!call.url.startsWith(`${target.base}/`)) return 'other';
  const step = ringStepOf(call);
  return RING_DATA_STEPS.has(step) ? 'graphql' : 'identity';
}

/**
 * A fresh mock state that already knows the device a previous run registered.
 * @param target - The issuer.
 * @param fault - Fault the ring answers with.
 * @returns The state.
 */
function freshState(target: IRingTarget, fault: RingFault): IRingState {
  const devices = new Map([[SYN_STORED_KEY, SYN_DEVICE_UDID]]);
  const isExpiryPending = fault === 'expireOnce';
  return { target, fault, sessions: new Map(), devices, isExpiryPending };
}

/**
 * Install a synthetic ring over globalThis.fetch.
 * @param target - The issuer the ring plays.
 * @param fault - Fault the ring answers with; `'none'` behaves normally.
 * @returns Handle with dispose, call counts and the call log.
 */
export function installRingFetchMock(target: IRingTarget, fault: RingFault = 'none'): IMockHandle {
  const state = freshState(target, fault);
  return installFetchMock({
    /**
     * Classify one call.
     * @param call - The recorded request.
     * @returns Its tally.
     */
    classify: (call: IRecordedCall): CallKind => classifyRing(target, call),
    /**
     * Answer one call.
     * @param call - The recorded request.
     * @returns The ring's answer.
     */
    answer: (call: IRecordedCall): Promise<Response> => answerRing(state, call),
  });
}
