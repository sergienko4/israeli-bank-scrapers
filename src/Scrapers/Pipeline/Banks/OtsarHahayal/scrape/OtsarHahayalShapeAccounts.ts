/**
 * Otsar Hahayal (FIBI group) scrape shape — identity URLs bound to the Otsar Hahayal
 * origin. The account-identity merge itself (userData accounts folded with the
 * session-level accountType) is origin-independent and lives in the neutral
 * FibiGroup factory, shared with the sibling brands.
 */

import {
  customerUrl as fibiCustomerUrl,
  secondaryUrl as fibiSecondaryUrl,
} from '../../../Phases/ApiDirectScrape/FibiGroup/FibiGroupShapeAccounts.js';
import type { WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';
import { OTSAR_HAHAYAL_CONFIG } from './OtsarHahayalShapeHelpers.js';

export {
  accountNumberOf,
  extractAccounts,
} from '../../../Phases/ApiDirectScrape/FibiGroup/FibiGroupShapeAccounts.js';

/**
 * Customer URL — the userData accounts endpoint on the Otsar Hahayal origin.
 * @returns Literal userData URL with a fresh uid.
 */
export function customerUrl(): WKUrlOrLiteral {
  return fibiCustomerUrl(OTSAR_HAHAYAL_CONFIG);
}

/**
 * Secondary identity URL — the session-level accountType lookup.
 * @returns Literal accountType-lookup URL with a fresh uid.
 */
export function secondaryUrl(): WKUrlOrLiteral {
  return fibiSecondaryUrl(OTSAR_HAHAYAL_CONFIG);
}
