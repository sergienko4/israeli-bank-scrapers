/**
 * WK barrel — reconstructs the WK object from atomic phase files.
 * Each phase file is isolated: no cross-pollination.
 *
 * Direct imports from phase files are preferred:
 *   import { WK_HOME } from './WK/HomeWK.js';
 *   import { WK_DASHBOARD } from './WK/DashboardWK.js';
 *
 * This barrel provides backward-compatible WK object shape during migration.
 */

export { WK_DASHBOARD } from './DashboardWK.js';
export { WK_HOME } from './HomeWK.js';
export { WK_CONCEPT_MAP, WK_LOGIN_ERROR, WK_LOGIN_FORM } from './LoginWK.js';
export { WK_PRELOGIN } from './PreLoginWK.js';
export { ACCOUNT_SIGNATURE_KEYS, TXN_SIGNATURE_KEYS } from './ScrapeWK.js';
export { WK_CLOSE_POPUP } from './SharedWK.js';
