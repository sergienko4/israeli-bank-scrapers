/**
 * Pagi (FIBI group) scrape shape — the transactions URL bound to the
 * Pagi origin. The request envelope and page extractor are
 * origin-independent and live in the neutral FibiGroup factory, which also owns
 * the window's upper bound (`scrapeWindowEnd`, never the clock) so the coverage
 * backfill keeps reaching the wire for every FIBI brand at once.
 */

import { txnsUrl as fibiTxnsUrl } from '../../../Phases/ApiDirectScrape/FibiGroup/FibiGroupShapeTxns.js';
import type { WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';
import { PAGI_CONFIG } from './PagiShapeHelpers.js';

export {
  txnsExtractPage,
  txnsVars,
} from '../../../Phases/ApiDirectScrape/FibiGroup/FibiGroupShapeTxns.js';

/**
 * Transactions URL — the fixed BFF list endpoint (params ride the body).
 * @returns Literal transactions-list URL.
 */
export function txnsUrl(): WKUrlOrLiteral {
  return fibiTxnsUrl(PAGI_CONFIG);
}
