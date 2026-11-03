/**
 * VisaCal headless registry block — isolated so the central registry stays
 * under its file cap. Login and data calls share CAL's mobile gateway; the
 * scrape Shape owns literal data URLs, so only the two login paths are seeded
 * here. Every path is a full URL, registered verbatim.
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
  // CAL's mobile gateway answers a plain Node client: no challenge page or TLS pinning.
  nativeFetch: true,
};

export default VISACAL_HEADLESS;
export { VISACAL_HEADLESS };
