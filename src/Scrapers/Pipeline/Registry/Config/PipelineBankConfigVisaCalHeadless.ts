/**
 * VisaCal headless registry block — isolated so the central registry stays
 * under its file cap. Login runs on CAL's mobile gateway; the scrape Shape
 * reaches the web gateway through literal URLs, so only the two login paths
 * are seeded here. Every path is a full URL, registered verbatim.
 */

import type { IHeadlessUrlsConfig } from './PipelineBankConfigTypes.js';

/** CAL mobile gateway — the host the Android app signs in on. */
const CAL_LOGIN_BASE = 'https://api-cc.cal-online.co.il/';

/** VisaCal headless identity and login endpoints. */
const VISACAL_HEADLESS: IHeadlessUrlsConfig = {
  identityBase: CAL_LOGIN_BASE,
  // CAL has no GraphQL; graphql mirrors identityBase to satisfy the type.
  graphql: CAL_LOGIN_BASE,
  paths: {
    'auth.login': `${CAL_LOGIN_BASE}Authentication/api/login/regularLogin`,
    'auth.resume': `${CAL_LOGIN_BASE}Authentication/api/login/bioLogin`,
  },
  // Both CAL gateways answer a plain Node client: no challenge page, no TLS pinning.
  nativeFetch: true,
};

export default VISACAL_HEADLESS;
export { VISACAL_HEADLESS };
