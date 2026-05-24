/**
 * PayBox synthetic fetch mock — intercepts globalThis.fetch for the
 * six PayBox REST endpoints so the login + scrape pipeline can be
 * exercised offline. Rule #18: every value is SYNTHETIC (no real PII).
 * Shared machinery lives in SyntheticFetchMockKit; this file declares
 * only the bank-specific dispatch + response payloads + the optional
 * `pinDigitsObserved` counter used by the OTP-scrub assertion.
 *
 * Response shapes mirror PAYBOX-SCRAPER-CONSTANTS.md (§3.1-§3.3 for
 * login, §6.4-§6.5 for data). Wire-format faithful with synthetic
 * values throughout.
 */

import type {
  IDispatchArgs,
  IMockHandle,
  IMockTally,
  IResponseLike,
} from '../Helpers/SyntheticFetchMockKit.js';
import { installSyntheticFetch, jsonOk, notFound } from '../Helpers/SyntheticFetchMockKit.js';

export type { IMockCallCounts, IMockHandle } from '../Helpers/SyntheticFetchMockKit.js';

/** Plaintext OTP code returned by the synthetic retriever. */
export const PAYBOX_MOCK_OTP_CODE = '9255';

/** 16-hex deviceId used by both cold and warm fixtures. */
const FIXT_DEVICE_ID = 'fixtdevicepb0001';

/** Milliseconds in one day — used to space synthetic transaction dates. */
const MS_PER_DAY = 86_400_000;

/** Seconds in approximately one calendar year (365 days). */
const SEC_PER_YEAR = 365 * 86_400;

/**
 * Build a synthetic JWT with the requested `exp` offset from now.
 * @param expDeltaSec - Seconds added to (now / 1000) for the exp claim.
 * @returns Three-segment compact JWT string.
 */
function buildJwt(expDeltaSec: number): string {
  const expSec = Math.floor(Date.now() / 1000) + expDeltaSec;
  const claimsJson = JSON.stringify({ exp: expSec });
  const claimsBuf = Buffer.from(claimsJson);
  const payload = claimsBuf.toString('base64url');
  return `synh.${payload}.synsig`;
}

/**
 * Synthetic OTP retriever — resolves with the configured plaintext code.
 * @returns Promise of the synthetic OTP digits.
 */
function syntheticOtpRetriever(): Promise<string> {
  return Promise.resolve(PAYBOX_MOCK_OTP_CODE);
}

/**
 * Cold-path credentials — phoneNumber + OTP retriever ONLY. The
 * scraper bootstraps `carry.deviceId16Hex` internally via the
 * mediator's `seedCarryFromCreds.bootstrap` hook, mirroring the
 * real-user surface where no deviceId is ever typed in.
 */
export const PAYBOX_MOCK_COLD_CREDS = Object.freeze({
  phoneNumber: '972-fixt-phone-pb-0001',
  otpCodeRetriever: syntheticOtpRetriever,
});

/** Warm-path credentials — long-term JWT with valid exp triggers warm short-circuit. */
export const PAYBOX_MOCK_WARM_CREDS = Object.freeze({
  phoneNumber: '972-fixt-phone-pb-0001',
  deviceId16Hex: FIXT_DEVICE_ID,
  otpLongTermToken: buildJwt(10 * SEC_PER_YEAR),
});

/** Stale-JWT credentials — exp in the past forces the cold path. */
export const PAYBOX_MOCK_STALE_CREDS = Object.freeze({
  phoneNumber: '972-fixt-phone-pb-0001',
  deviceId16Hex: FIXT_DEVICE_ID,
  otpLongTermToken: buildJwt(-2 * SEC_PER_YEAR),
  otpCodeRetriever: syntheticOtpRetriever,
});

/** uId echoed back by the synthetic loginBySms response. */
const SYN_UID = 'fixtuidpb0001fixtuidpb01';

type JsonObject = Record<string, unknown>;

/**
 * Synthetic /phoneValidate response — first SMS-OTP step.
 * @returns Envelope carrying access_token1.
 */
function phoneValidateResponse(): JsonObject {
  return { code: 200, content: { access_token: 'syn-pb-access-1', hasSocial: false } };
}

/**
 * Synthetic /pinValidation response — second SMS-OTP step.
 * @returns Envelope carrying access_token2 + validationResult.
 */
function pinValidationResponse(): JsonObject {
  return {
    code: 200,
    content: { access_token: 'syn-pb-access-2', validationResult: 'validated' },
  };
}

/**
 * Synthetic /loginBySms response — final SMS-OTP step.
 * @returns Envelope carrying the long-term JWT + uId + key bundle.
 */
function loginBySmsResponse(): JsonObject {
  return {
    code: 200,
    content: {
      access_token: buildJwt(10 * SEC_PER_YEAR),
      uId: SYN_UID,
      userObject: { keys: {} },
    },
  };
}

/**
 * Build one synthetic wallet notification row (PbNotification shape).
 * @param seq - 1-based row index used for ordering + descriptive fields.
 * @returns One JSON row.
 */
function makeWalletRow(seq: number): JsonObject {
  const seqStr = String(seq);
  const tsMs = String(Date.now() - seq * MS_PER_DAY);
  return {
    transactionId: `syn-wallet-${seqStr}`,
    ts: tsMs,
    merchantName: `synthetic merchant ${seqStr}`,
    amount: seq * 10,
    transactionCurrency: 'ILS',
    type: seq % 2 === 0 ? 'credit' : 'debit',
    stat: 'completed',
    comment: '',
  };
}

/**
 * Generate the synthetic wallet row collection (12 rows).
 * @returns Frozen array of wallet rows.
 */
function buildWalletRows(): readonly JsonObject[] {
  const indexes = Array.from({ length: 12 }, (_unused, idx) => idx + 1);
  return indexes.map(makeWalletRow);
}

/** 12 synthetic wallet rows — matches T39 minTxns wallet threshold. */
const WALLET_ROWS: readonly JsonObject[] = buildWalletRows();

/**
 * Synthetic /getUserHistory response — wallet activity page + uId echo.
 * The uId echo at root supports the customer.extractAccounts step.
 * @returns Envelope carrying wallet rows.
 */
function getUserHistoryResponse(): JsonObject {
  return {
    code: 200,
    uId: SYN_UID,
    content: { nc: WALLET_ROWS, idMatch: true },
  };
}

/**
 * Build one synthetic debit transaction row.
 * @param seq - 1-based row index used for ordering + descriptive fields.
 * @returns One JSON row.
 */
function makeDebitRow(seq: number): JsonObject {
  const seqStr = String(seq);
  const dateIso = new Date(Date.now() - seq * MS_PER_DAY).toISOString();
  return {
    id: 1000 + seq,
    date: dateIso,
    amount: seq * 25,
    merchantName: `synthetic debit ${seqStr}`,
    status: 'completed',
    currency: 'ILS',
  };
}

/**
 * Generate the synthetic debit row collection (7 rows).
 * @returns Frozen array of debit rows.
 */
function buildDebitRows(): readonly JsonObject[] {
  const indexes = Array.from({ length: 7 }, (_unused, idx) => idx + 1);
  return indexes.map(makeDebitRow);
}

/** 7 synthetic debit rows — matches T39 minTxns debit threshold. */
const DEBIT_ROWS: readonly JsonObject[] = buildDebitRows();

/**
 * Synthetic /virtualCardTranRequest response — debit-card transactions.
 * @returns Envelope carrying debit rows.
 */
function virtualCardTranRequestResponse(): JsonObject {
  return { code: 200, content: { filteredTransactions: DEBIT_ROWS } };
}

/**
 * Synthetic /sync response — balance snapshot (not exercised by the
 * current PayBox shape but kept for protocol parity).
 * @returns Envelope carrying userFunds.balance.
 */
function syncResponse(): JsonObject {
  return {
    code: 200,
    content: {
      userFunds: { balance: 1500.5 },
      modifiedGroups: [],
      events: [],
    },
  };
}

/**
 * Read the raw request body string out of a fetch RequestInit.
 * @param init - Fetch init (may be absent).
 * @returns Body string or '' when absent / non-string.
 */
function readBody(init?: RequestInit): string {
  const raw = init?.body;
  if (typeof raw !== 'string') return '';
  return raw;
}

/**
 * Detect plaintext OTP digits in the dispatched body and bump the
 * `pinDigitsObserved` counter when found. Used by the OTP-scrub
 * assertion to prove cryptoField encrypted the digits before send.
 * @param tally - Mutable tally to update (extras include pinDigitsObserved).
 * @param init - Fetch init for the current request.
 * @returns True when a plaintext digit was observed.
 */
function trackPinScrub(tally: IMockTally, init?: RequestInit): boolean {
  const body = readBody(init);
  if (body.length === 0) return false;
  const plaintextMarker = `"${PAYBOX_MOCK_OTP_CODE}"`;
  if (!body.includes(plaintextMarker)) return false;
  tally.pinDigitsObserved = tally.pinDigitsObserved + 1;
  return true;
}

/** Counter slot the route increments on the kit's tally. */
type TallySlot = 'identity' | 'graphql';

/** One PayBox endpoint route — path fragment, tally slot, handler. */
interface IPayBoxRoute {
  readonly path: string;
  readonly slot: TallySlot;
  readonly handler: (args: IDispatchArgs) => JsonObject;
}

/**
 * Handler for /pinValidation — tracks scrubbed digits + returns envelope.
 * @param args - Dispatch args (tally + init read here).
 * @returns pinValidation envelope.
 */
function handlePinValidation(args: IDispatchArgs): JsonObject {
  trackPinScrub(args.tally, args.init);
  return pinValidationResponse();
}

/**
 * Handler for /loginBySms — tracks scrubbed digits + returns envelope.
 * @param args - Dispatch args (tally + init read here).
 * @returns loginBySms envelope.
 */
function handleLoginBySms(args: IDispatchArgs): JsonObject {
  trackPinScrub(args.tally, args.init);
  return loginBySmsResponse();
}

/** Static routing map — preserves the original PayBox dispatch order. */
const PAYBOX_ROUTES: readonly IPayBoxRoute[] = [
  { path: '/phoneValidate', slot: 'identity', handler: phoneValidateResponse },
  { path: '/pinValidation', slot: 'identity', handler: handlePinValidation },
  { path: '/loginBySms', slot: 'identity', handler: handleLoginBySms },
  { path: '/getUserHistory', slot: 'graphql', handler: getUserHistoryResponse },
  { path: '/virtualCardTranRequest', slot: 'graphql', handler: virtualCardTranRequestResponse },
  { path: '/sync', slot: 'graphql', handler: syncResponse },
];

/**
 * PayBox dispatch — bank-specific URL → synthetic response routing.
 * @param args - URL + init + tally bundle.
 * @returns Response-like.
 */
function dispatchPayBox(args: IDispatchArgs): IResponseLike {
  const route = PAYBOX_ROUTES.find(r => args.url.includes(r.path));
  if (route === undefined) return notFound(`unmocked: ${args.url}`);
  args.tally[route.slot] += 1;
  const envelope = route.handler(args);
  return jsonOk(envelope);
}

/**
 * Install the synthetic PayBox fetch mock with the `pinDigitsObserved`
 * counter pre-initialised to 0.
 * @returns Handle that restores original fetch + exposes call counts.
 */
export function installPayBoxFetchMock(): IMockHandle {
  return installSyntheticFetch({
    dispatch: dispatchPayBox,
    extraCounters: { pinDigitsObserved: 0 },
  });
}
