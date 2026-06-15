/**
 * AccountScrape shared leaf helpers — URL date-range patching + the
 * slim TXN-endpoint fieldMap resolver. Extracted from
 * AccountScrapeStrategy.ts during the Phase 12e file-size drain so the
 * POST sub-module and the orchestrator both consume them without a
 * cyclic import. Respects the canonical `max-lines:150` ceiling.
 */

import { applyDateRangeAndAppendWithCount } from '../../../Mediator/Scrape/UrlDateRange.js';
import type { Brand } from '../../../Types/Brand.js';
import { getDebug as createLogger } from '../../../Types/Debug.js';
import type { ITxnEndpoint } from '../../../Types/PipelineContext.js';
import { parseStartDate } from '../ScrapeDataActions.js';
import { EMPTY_TXN_ENDPOINT, type IAccountFetchCtx } from '../ScrapeTypes.js';

type PatchedUrlStr = Brand<string, 'PatchedUrlStr'>;

const LOG = createLogger('scrape-post');

/**
 * Resolve the slim ITxnEndpoint to its fieldMap for parseFreshResponse.
 * Returns the EMPTY default's fieldMap when DASHBOARD didn't commit one
 * — `parseFreshResponse` then falls back to auto-discovery.
 *
 * @param fc - Fetch context.
 * @returns FieldMap aliases for the per-account fresh-response parse.
 */
function txnEpForParse(fc: IAccountFetchCtx): ITxnEndpoint['fieldMap'] {
  return (fc.txnEndpoint ?? EMPTY_TXN_ENDPOINT).fieldMap;
}

/**
 * Patch URL query-string date params from fc.startDate → today.
 * No-op when no WK.fromDate / WK.toDate keys are present.
 * @param url - Captured URL.
 * @param fc - Fetch context.
 * @returns Patched URL.
 */
function patchUrlRange(url: string, fc: IAccountFetchCtx): PatchedUrlStr {
  const fromDate = parseStartDate(fc.startDate);
  const toDate = new Date();
  const outcome = applyDateRangeAndAppendWithCount(url, {
    fromDate,
    toDate,
    windowParams: fc.dateWindowParams ?? [],
  });
  if (outcome.swapped > 0) {
    LOG.debug({
      message: `URL date-range patched (${String(outcome.swapped)} params)`,
    });
  }
  return outcome.url as PatchedUrlStr;
}

export { patchUrlRange, txnEpForParse };
