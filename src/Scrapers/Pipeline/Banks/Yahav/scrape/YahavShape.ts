/**
 * Yahav native scrape shape — the single
 * `IApiDirectScrapeShape` the browserless Yahav plugs into the ApiDirectScrape
 * driver. Zero logic here: the bootstrap logs in to BaNCS and resolves the
 * portfolio, the response session rotates the session state on every answer,
 * the body digest signs every body, and the accounts, balance and
 * transactions reads post to the multiplexed account route.
 */

import type { IApiDirectScrapeShape } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { YAHAV_BODY_DIGEST } from '../../../Registry/Config/PipelineBankConfigYahavConstants.js';
import { YAHAV_BALANCE, YAHAV_CUSTOMER } from './YahavShapeAccounts.js';
import { YAHAV_BOOTSTRAP } from './YahavShapeBootstrap.js';
import type { IYahavAcct } from './YahavShapeHelpers.js';
import { SCRAPE_LABEL } from './YahavShapeHelpers.js';
import { YAHAV_RESPONSE_SESSION } from './YahavShapeSession.js';
import { YAHAV_TXNS } from './YahavShapeTxns.js';

/**
 * User-facing account number — the BaNCS account id.
 * @param acct - The account.
 * @returns Account id.
 */
function accountNumberOf(acct: IYahavAcct): string {
  return acct.id;
}

/** Yahav native scrape shape. */
export const YAHAV_SHAPE: IApiDirectScrapeShape<IYahavAcct, number> = {
  stepName: SCRAPE_LABEL,
  accountNumberOf,
  bootstrap: YAHAV_BOOTSTRAP,
  bodyDigest: YAHAV_BODY_DIGEST,
  responseSession: YAHAV_RESPONSE_SESSION,
  customer: YAHAV_CUSTOMER,
  balance: YAHAV_BALANCE,
  transactions: YAHAV_TXNS,
};

export default YAHAV_SHAPE;
