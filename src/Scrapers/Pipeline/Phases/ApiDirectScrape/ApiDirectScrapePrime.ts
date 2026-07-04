/**
 * ApiDirectScrape post-login PRIME navigation.
 *
 * <p>Some browser banks (Amex, Isracard) authorize their LOGIN-origin
 * service via first-party cookies, but gate the TRANSACTIONS service behind
 * a separate session the SPA only establishes when it navigates to its
 * frontend route. A fresh api-direct fetch skips that navigation, so the
 * transactions endpoint 302-redirects to login. This step lifts the proven
 * generic-DASHBOARD behaviour (navigate the live login page to the bank's
 * SPA route, then settle) into the hard-model path — the SSO handshake +
 * referer + bootstrap XHRs prime the service so the scrape fetches return
 * 200 instead of 302.
 *
 * <p>Best-effort by design: `navigateTo` swallows its own errors (returns a
 * failure Procedure the driver ignores) and `waitForNetworkIdle` treats
 * timeouts as non-fatal, so a slow SPA never fails the scrape — a genuinely
 * broken session surfaces its own loud error on the first data fetch. Banks
 * that declare no `prime` (cookie-only + headless) no-op here.
 */

import { isSome } from '../../Types/Option.js';
import type { IDriverCtx } from './ApiDirectScrapeDispatchArgs.js';

/** Nav budget for the prime route; a timeout is non-fatal (swallowed). */
const PRIME_NAV_TIMEOUT_MS = 20_000;
/** Post-load settle window covering the SPA's bootstrap XHR burst. */
const PRIME_SETTLE_MS = 3000;
/** Nav options — wait for the bootstrap XHRs to settle, time-bounded. */
const PRIME_NAV_OPTS = { waitUntil: 'networkidle', timeout: PRIME_NAV_TIMEOUT_MS } as const;

/**
 * Navigate the live login page to the bank's SPA route so a
 * separate-session transactions service is primed before the first scrape
 * fetch. No-op when the shape declares no `prime` or no executor is bound
 * (headless banks). Best-effort — never fails the scrape.
 * @param d - Driver context (shape + bus + action context).
 * @returns Resolves once the best-effort prime completes.
 */
async function runPrime<TAcct, TCursor>(d: IDriverCtx<TAcct, TCursor>): Promise<void> {
  const prime = d.shape.prime;
  const executor = d.ctx.executor;
  if (prime !== undefined && isSome(executor)) {
    const navUrl = prime.navUrl(d.ctx);
    await executor.value.navigateTo(navUrl, PRIME_NAV_OPTS);
    await executor.value.waitForNetworkIdle(PRIME_SETTLE_MS);
  }
}

export default runPrime;
