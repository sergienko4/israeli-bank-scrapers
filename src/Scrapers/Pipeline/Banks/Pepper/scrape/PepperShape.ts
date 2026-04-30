/**
 * Pepper scrape shape — pure data declaration consumed by the generic
 * buildGenericHeadlessScrape driver. Numeric cursor (1-based page
 * number), posted + pending rows merged per page, termination when
 * totalCount is reached or a page underfills. Helpers split into
 * PepperShapeHelpers.ts (customer/balance) + PepperShapeTxns.ts.
 */

import { randomUUID } from 'node:crypto';

import type { IActionContext } from '../../../Types/PipelineContext.js';
import type { HeaderMap, IHeadlessScrapeShape } from '../../_Shared/HeadlessScrapeShape.js';
import type { IPepperCreds } from '../PepperCreds.js';
import {
  accountNumberOf,
  balanceExtract,
  balanceVars,
  customerVars,
  extractAccounts,
  type IPepperAcct,
} from './PepperShapeHelpers.js';
import { txnsExtractPage, txnsVars } from './PepperShapeTxns.js';

/** Pepper Android client version header (from APK manifest). */
const APP_VERSION = '11.5.1-202603051858';

/** Stable per-install client id — generated once per process. */
const PEPPER_CLIENT_ID = randomUUID();

/** Pepper x-user-id header value (phone without country-code prefix). */
type PepperUserId = string;

/**
 * Resolve the x-user-id header — Pepper uses the phone without the
 * country-code prefix (first 3 digits "972" dropped).
 * @param ctx - Action context carrying credentials.
 * @returns x-user-id string (empty when phone absent).
 */
function userIdOf(ctx: IActionContext): PepperUserId {
  const creds = ctx.credentials as unknown as IPepperCreds;
  const digits = creds.phoneNumber.replaceAll(/\D/g, '');
  if (digits.startsWith('972')) return digits.slice(3);
  return digits;
}

/**
 * Build the per-call GraphQL header set for a given queryname.
 * x-transaction-id is fresh per call; x-pepper-id + x-user-id stable.
 * @param queryname - GraphQL operation name.
 * @returns Function that produces the header map at call time.
 */
function dynamicHeaders(queryname: string): (ctx: IActionContext) => HeaderMap {
  return (ctx): HeaderMap => ({
    queryname,
    'x-pepper-id': PEPPER_CLIENT_ID,
    'x-user-id': userIdOf(ctx),
    appversion: APP_VERSION,
    'x-transaction-id': randomUUID(),
  });
}

/** Pepper shape declaration — passed to buildGenericHeadlessScrape. */
const PEPPER_SHAPE: IHeadlessScrapeShape<IPepperAcct, number> = {
  stepName: 'PepperScrape',
  accountNumberOf,
  customer: {
    buildVars: customerVars,
    extractAccounts,
    extraHeaders: dynamicHeaders('UserDataV2'),
  },
  balance: {
    buildVars: balanceVars,
    extract: balanceExtract,
    extraHeaders: dynamicHeaders('fetchAccountBalance'),
  },
  transactions: {
    buildVars: txnsVars,
    extractPage: txnsExtractPage,
    extraHeaders: dynamicHeaders('Transactions'),
  },
};

export default PEPPER_SHAPE;
export { PEPPER_SHAPE, userIdOf };
