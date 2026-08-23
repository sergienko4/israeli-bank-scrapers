/**
 * Beinleumi (FIBI group) scrape shape — identity URLs bound to the Beinleumi
 * origin. The account-identity merge itself (userData accounts folded with the
 * session-level accountType) is origin-independent and lives in the neutral
 * FibiGroup factory, shared with the sibling brands.
 */

import {
  customerUrl as fibiCustomerUrl,
  secondaryUrl as fibiSecondaryUrl,
} from '../../../Phases/ApiDirectScrape/FibiGroup/FibiGroupShapeAccounts.js';
import type { WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';
import { BEINLEUMI_CONFIG } from './BeinleumiShapeHelpers.js';

export {
  accountNumberOf,
  extractAccounts,
} from '../../../Phases/ApiDirectScrape/FibiGroup/FibiGroupShapeAccounts.js';

/**
 * Customer URL — the userData accounts endpoint on the Beinleumi origin.
 * @returns Literal userData URL with a fresh uid.
 */
export function customerUrl(): WKUrlOrLiteral {
  return fibiCustomerUrl(BEINLEUMI_CONFIG);
}

/**
 * Secondary identity URL — the session-level accountType lookup.
 * @returns Literal accountType-lookup URL with a fresh uid.
 */
export function secondaryUrl(): WKUrlOrLiteral {
  return fibiSecondaryUrl(BEINLEUMI_CONFIG);
}
