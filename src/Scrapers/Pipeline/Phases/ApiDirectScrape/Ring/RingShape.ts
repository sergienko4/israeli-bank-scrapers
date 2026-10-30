/**
 * Ring scrape shape — the neutral family factory for the card issuers that
 * run the ring app API (Isracard, Amex). One factory builds every brand's
 * shape: cards from `CardsList_102Digital`, one GatewayV2
 * GetTransactionsList per card month, and the next debit from the same call
 * for the card's next statement month.
 *
 * The factory owns only what every ring issuer shares — the request
 * envelope, the headers, and the response extractors. The ring constants,
 * step name, and coverage-backfill stance stay with the brand, so each
 * brand keeps declaring its own stance in its own module (which the
 * WINDOW-CANARY gate scans) and no bank ever imports another bank.
 *
 * Every ring reply carries an envelope the bank fills inside an HTTP 200:
 * the `service` endpoint a `Header.Status` ('1' confirmed, '-2' an expired
 * session) and GatewayV2 an `isSuccess` flag. The body check fails any reply
 * the bank did not confirm, so a refused call never reads as an empty card
 * list or an empty month, and a warm run re-logs in once. GatewayV2 reports
 * an expired session as an HTTP 500, which already fails the call.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { IRingConstants } from '../../../Registry/Config/PipelineBankConfigRingConstants.js';
import type { LiteralUrl } from '../../../Registry/WK/UrlsWK.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';
import { validateCardIssuerPlan } from '../CardIssuer/CardIssuerShapeTxns.js';
import {
  type ApiBody,
  BALANCE_UNKNOWN,
  type IApiDirectScrapeShape,
  type WindowNarrowing,
} from '../IApiDirectScrapeShape.js';
import { balanceIsAbsent, balanceVars, nextDebitOf } from './RingShapeBalance.js';
import {
  accountNumberOf,
  buildExtractCards,
  cardsUrl,
  cardsVars,
  type IRingCard,
} from './RingShapeCards.js';
import { RING_DECLARED_ROWS } from './RingShapeExtract.js';
import { buildRingHeaders, type RingHeaders } from './RingShapeHeaders.js';
import { gatewayUrl, txnsExtractPage, txnsVars } from './RingShapeTxns.js';

/** A ring shape: one card per account, month cursor. */
export type RingShape = IApiDirectScrapeShape<IRingCard, number>;

type RingVerdict = 'ok' | 'expired' | 'refused';

/** The `service` endpoint's `Header.Status` codes; any other code is a refusal. */
const SERVICE_STATUS: Readonly<Record<string, RingVerdict>> = { '1': 'ok', '-2': 'expired' };

/** Fixed failure text — the bank's own code is never echoed. */
const REFUSAL_MESSAGE: Readonly<Record<Exclude<RingVerdict, 'ok'>, string>> = {
  expired: 'ring session expired',
  refused: 'ring call refused',
};

interface IRingEnvelope {
  readonly Header?: { readonly Status?: unknown } | null;
  readonly isSuccess?: unknown;
}

/**
 * Read the bank's verdict from a ring reply's envelope.
 * @param body - Successful response body.
 * @returns `ok` only for a reply the bank confirmed.
 */
function verdictOf(body: ApiBody): RingVerdict {
  const envelope = body as IRingEnvelope;
  const header = envelope.Header;
  if (header === undefined || header === null)
    return envelope.isSuccess === true ? 'ok' : 'refused';
  const status = String(header.Status);
  return Object.hasOwn(SERVICE_STATUS, status) ? SERVICE_STATUS[status] : 'refused';
}

/**
 * Fail a ring reply the bank did not confirm.
 * @param body - Successful response body.
 * @returns The body, or a Generic failure for an expired or refused call.
 */
export function checkRingBody(body: ApiBody): Procedure<ApiBody> {
  const verdict = verdictOf(body);
  if (verdict === 'ok') return succeed(body);
  return fail(ScraperErrorTypes.Generic, REFUSAL_MESSAGE[verdict]);
}

/** One ring brand's binding of the shared family contract. */
export interface IRingShapeArgs {
  /** Pipeline step name, e.g. `IsracardScrape`. */
  readonly stepName: string;
  /** The brand's own coverage-backfill stance. */
  readonly windowNarrowing: WindowNarrowing;
  /** The brand's ring constants (origin, app id, company code). */
  readonly ring: IRingConstants;
}

/** The transport every ring step shares: a POST carrying ring headers. */
interface IRingCall {
  readonly urlTag: LiteralUrl;
  readonly method: 'POST';
  readonly extraHeaders: RingHeaders;
}

type RingSteps = Pick<RingShape, 'customer' | 'balance' | 'transactions'>;

/**
 * Bind one ring endpoint to the shared POST transport.
 * @param urlTag - Endpoint URL.
 * @param headers - Ring headers builder.
 * @returns Step transport fields.
 */
function ringPost(urlTag: LiteralUrl, headers: RingHeaders): IRingCall {
  return { urlTag, method: 'POST', extraHeaders: headers };
}

/**
 * The card-list step.
 * @param ring - The brand's ring constants.
 * @param headers - Ring headers builder.
 * @returns Customer step.
 */
function cardsStep(ring: IRingConstants, headers: RingHeaders): RingShape['customer'] {
  const url = cardsUrl(ring);
  const call = ringPost(url, headers);
  const extractAccounts = buildExtractCards(ring);
  return { buildVars: cardsVars, extractAccounts, ...call };
}

/**
 * The next-debit balance step.
 * @param gateway - GatewayV2 transport.
 * @returns Balance step.
 */
function balanceStep(gateway: IRingCall): RingShape['balance'] {
  return {
    buildVars: balanceVars,
    isAbsent: balanceIsAbsent,
    extract: nextDebitOf,
    // A failed call keeps the card and its transactions and publishes no
    // balance, rather than a 0 the issuer never sent.
    fallbackOnFail: BALANCE_UNKNOWN,
    ...gateway,
  };
}

/**
 * The monthly transactions step.
 * @param stance - The brand's coverage-backfill stance.
 * @param gateway - GatewayV2 transport.
 * @returns Transactions step.
 */
function txnsStep(stance: WindowNarrowing, gateway: IRingCall): RingShape['transactions'] {
  return {
    buildVars: txnsVars,
    extractPage: txnsExtractPage,
    validatePlan: validateCardIssuerPlan,
    windowNarrowing: stance,
    declaredRowSpecs: RING_DECLARED_ROWS,
    ...gateway,
  };
}

/**
 * The three scrape steps for one ring brand.
 * @param args - Brand binding: ring constants and backfill stance.
 * @returns Customer, balance and transactions steps.
 */
function ringSteps(args: IRingShapeArgs): RingSteps {
  const headers = buildRingHeaders(args.ring);
  const gatewayTag = gatewayUrl(args.ring);
  const gateway = ringPost(gatewayTag, headers);
  return {
    customer: cardsStep(args.ring, headers),
    balance: balanceStep(gateway),
    transactions: txnsStep(args.windowNarrowing, gateway),
  };
}

/**
 * Assemble one ring brand's hard-model scrape shape.
 * @param args - Brand binding: ring constants, step name, backfill stance.
 * @returns Shape passed to `.withApiDirect(...)`.
 */
export function makeRingShape(args: IRingShapeArgs): RingShape {
  // A card issuer: charges arrive positive and the mapper flips them.
  return {
    stepName: args.stepName,
    accountNumberOf,
    isCardIssuer: true,
    checkBody: checkRingBody,
    ...ringSteps(args),
  };
}
