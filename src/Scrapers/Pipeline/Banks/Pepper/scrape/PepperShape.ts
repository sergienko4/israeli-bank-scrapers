/**
 * Pepper scrape shape — pure data declaration consumed by the generic
 * buildGenericHeadlessScrape driver. Numeric cursor (1-based page
 * number), posted + pending rows merged per page, termination when
 * totalCount is reached or a page underfills. Helpers split into
 * PepperShapeHelpers.ts (customer/balance) + PepperShapeTxns.ts.
 */

import { randomUUID } from 'node:crypto';

import type {
  HeaderMap,
  IApiDirectScrapeShape,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { Brand } from '../../../Types/Brand.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import type { IPepperCreds } from '../PepperCreds.js';

/** Pepper user id (phone without country code) — branded for Rule #15. */
type PepperUserId = Brand<string, 'PepperUserId'>;
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

/**
 * Resolve the x-user-id header — Pepper uses the phone without the
 * country-code prefix (local-only form).
 *
 * Pepper's `phoneNumberFormat` is `'international-flat'` so the body
 * templates receive `972XXXXXXXXX`. The x-user-id header, however,
 * is a SEPARATE concern (header vs body) and expects the local form,
 * so this helper strips the `972` prefix when present. Robust to
 * either form so it can absorb a future config change.
 * @param ctx - Action context carrying credentials.
 * @returns x-user-id string (empty when phone absent).
 */
function userIdOf(ctx: IActionContext): PepperUserId {
  const creds = ctx.credentials as unknown as IPepperCreds;
  const candidate = creds.phoneNumber as unknown;
  const raw = typeof candidate === 'string' ? candidate : '';
  if (raw.startsWith('972')) return raw.slice(3) as unknown as PepperUserId;
  return raw as unknown as PepperUserId;
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
const PEPPER_SHAPE: IApiDirectScrapeShape<IPepperAcct, number> = {
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
