/**
 * DNS-critical auth/API hosts that are NOT the bank's `urls.base`.
 *
 * CI warms bank DNS before Camoufox launches. That warmup derives its
 * host list from `urls.base` in the bank registry, so it only ever
 * warmed each bank's marketing apex. Every host a login handshake
 * actually talks to -- the auth iframe origin, the post-login API
 * origin -- stayed cold, and a cold lookup inside Camoufox (which
 * retries for ~6s before giving up) surfaces as
 * `NS_ERROR_UNKNOWN_HOST`: a blank login form with zero fields
 * resolved, indistinguishable from a scraper bug.
 *
 * Yahav is the worst case and the reason this file exists: its login
 * form is an iframe whose origin (`login.yahav.co.il`) appears in no
 * source file at all -- it arrives at runtime as an iframe `src`
 * attribute from the marketing page. No extractor can discover it, so
 * it must be declared.
 *
 * Entries are deliberately hand-curated rather than grepped out of
 * the source tree, because the source tree also contains hosts that
 * must NOT be warmed: `he.isracard.co.il` has no A record at all, and
 * failing loud on it would hold every E2E run red forever.
 *
 * One line per bank keeps the shape trivially greppable by
 * `.github/scripts/ci/dns-warmup.sh`, which runs before `npm install`
 * and therefore cannot import TypeScript.
 */

import { CompanyTypes } from '../../../../Definitions.js';

/** Extra hosts to warm per bank, beyond the registry's `urls.base`. */
export type BankExtraDnsHosts = Readonly<Partial<Record<CompanyTypes, readonly string[]>>>;

/**
 * Auth/API origins each bank's flow depends on, keyed by company.
 *
 * Every entry is referenced by that bank's pipeline module (see the
 * `*ShapeHelpers` / `*Static` constants) except Yahav's
 * `login.yahav.co.il`, which is runtime-discovered and declared here
 * for that reason. Banks whose entire flow lives on `urls.base`
 * (Max) are intentionally absent.
 */
export const BANK_EXTRA_DNS_HOSTS: BankExtraDnsHosts = {
  [CompanyTypes.Amex]: ['web.americanexpress.co.il'],
  [CompanyTypes.Beinleumi]: ['online.fibi.co.il'],
  [CompanyTypes.Discount]: ['start.telebank.co.il'],
  [CompanyTypes.Hapoalim]: ['login.bankhapoalim.co.il'],
  [CompanyTypes.Isracard]: ['web.isracard.co.il'],
  [CompanyTypes.Leumi]: ['hb2.bankleumi.co.il'],
  [CompanyTypes.Massad]: ['online.bankmassad.co.il'],
  [CompanyTypes.Mercantile]: ['start.telebank.co.il'],
  [CompanyTypes.OneZero]: ['identity.tfd-bank.com', 'mobile.tfd-bank.com'],
  [CompanyTypes.OtsarHahayal]: ['online.bankotsar.co.il'],
  [CompanyTypes.Pagi]: ['online.pagi.co.il'],
  [CompanyTypes.PayBox]: ['apipin.payboxapp.com'],
  [CompanyTypes.Pepper]: ['fe-sec.pepper.co.il', 'sa.pepper.co.il'],
  [CompanyTypes.VisaCal]: ['digital-web.cal-online.co.il', 'api.cal-online.co.il'],
  [CompanyTypes.Yahav]: ['digital.yahav.co.il', 'login.yahav.co.il'],
};
