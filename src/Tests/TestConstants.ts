/**
 * Test constants derived from scraper configuration.
 *
 * Centralises hardcoded URLs used across integration tests so they
 * stay in sync with the production login configs.
 */
import { CompanyTypes } from '../Definitions.js';
import ScraperError from '../Scrapers/Base/ScraperError.js';
import { DISCOUNT_SUCCESS_URL } from '../Scrapers/Discount/Config/DiscountLoginConfig.js';
import { SCRAPER_CONFIGURATION } from '../Scrapers/Registry/Config/ScraperConfig.js';

const CFG = SCRAPER_CONFIGURATION.banks;

/**
 * Require a non-null config value, throwing at module load time if missing.
 * @param value - The config value to check.
 * @param name - Human-readable config key name for the error message.
 * @returns The value, guaranteed to be a string.
 */
function requireConfig(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ScraperError(`Required config "${name}" is missing`);
  }
  return value;
}

// ---- Hapoalim ----

/** Hapoalim base URL from scraper configuration. */
export const HAPOALIM_BASE_URL = CFG[CompanyTypes.Hapoalim].urls.base;

/** Hapoalim API base URL. */
export const HAPOALIM_API_URL = CFG[CompanyTypes.Hapoalim].api.base;

/** Hapoalim primary success URL (first possibleResults entry). */
export const HAPOALIM_SUCCESS_URL = `${CFG[CompanyTypes.Hapoalim].api.base}/portalserver/HomePage`;

/** Hapoalim login error URL for invalid password tests. */
export const HAPOALIM_LOGIN_ERROR_URL =
  `${CFG[CompanyTypes.Hapoalim].api.base}/AUTHENTICATE/LOGON` +
  '?flow=AUTHENTICATE&state=LOGON&errorcode=1.6&callme=false';

// ---- Leumi ----

/** Leumi base URL from scraper configuration. */
export const LEUMI_BASE_URL = CFG[CompanyTypes.Leumi].urls.base;

/** Leumi API base URL. */
export const LEUMI_API_URL = CFG[CompanyTypes.Leumi].api.base;

/** Leumi success URL matching the `/ebanking/SO/SPA.aspx` pattern. */
export const LEUMI_SUCCESS_URL = `${CFG[CompanyTypes.Leumi].api.base}/ebanking/SO/SPA.aspx`;

/** Leumi login URL for invalid login tests. */
export const LEUMI_LOGIN_URL = `${CFG[CompanyTypes.Leumi].api.base}/login`;

// ---- Discount ----

/** Discount base URL from scraper configuration. */
export const DISCOUNT_BASE_URL = CFG[CompanyTypes.Discount].urls.base;

/** Discount API base URL. */
export const DISCOUNT_API_URL = CFG[CompanyTypes.Discount].api.base;

/** Discount invalid-password URL (stays on login page). */
export const DISCOUNT_LOGIN_PAGE_URL = `${CFG[CompanyTypes.Discount].api.base}/apollo/core/templates/lobby/masterPage.html#/LOGIN_PAGE`;

export { DISCOUNT_SUCCESS_URL };

// ---- Max ----

/** Max base URL from scraper configuration. */
export const MAX_BASE_URL = CFG[CompanyTypes.Max].urls.base;

/** Max API base URL. */
export const MAX_API_URL = CFG[CompanyTypes.Max].api.base;

/** Max success URL matching the `/homepage/personal` path. */
export const MAX_SUCCESS_URL = `${CFG[CompanyTypes.Max].urls.base}/homepage/personal`;

/** Max login URL for invalid login tests. */
export const MAX_LOGIN_URL = `${CFG[CompanyTypes.Max].urls.base}/login`;

// ---- VisaCal ----

/** VisaCal base URL from scraper configuration. */
export const VISACAL_BASE_URL = CFG[CompanyTypes.VisaCal].urls.base;

const VISACAL_CAL_ORIGIN = requireConfig(
  CFG[CompanyTypes.VisaCal].api.calOrigin,
  'VisaCal.api.calOrigin',
);

/** VisaCal dashboard origin (calOrigin). */
export const VISACAL_ORIGIN = VISACAL_CAL_ORIGIN;

/** VisaCal success URL matching the `/dashboard` pattern. */
export const VISACAL_SUCCESS_URL = `${VISACAL_CAL_ORIGIN}/dashboard`;

/** VisaCal connect base URL for iframe login. */
export const VISACAL_CONNECT_LOGIN_URL = 'https://connect.cal-online.co.il/login';

/** VisaCal connect auth API URL for login response interception. */
export const VISACAL_CONNECT_AUTH_URL =
  'https://connect.cal-online.co.il/col-rest/calconnect/authentication/login';

/** VisaCal login URL (base URL) for invalid login tests. */
export const VISACAL_LOGIN_URL = CFG[CompanyTypes.VisaCal].urls.base;

// ---- Beinleumi ----

/** Beinleumi base URL from scraper configuration. */
export const BEINLEUMI_BASE_URL = CFG[CompanyTypes.Beinleumi].urls.base;

/** Beinleumi test base URL used in the TestBeinleumiScraper stub. */
export const BEINLEUMI_TEST_BASE_URL = 'https://test.fibi.co.il';

/** Beinleumi test transactions URL. */
export const BEINLEUMI_TEST_TRANSACTIONS_URL = `${BEINLEUMI_TEST_BASE_URL}/transactions`;

/** Beinleumi success URL matching the `/Resources/PortalNG/shell` pattern. */
export const BEINLEUMI_SUCCESS_URL = `${BEINLEUMI_TEST_BASE_URL}/Resources/PortalNG/shell`;

/** Beinleumi marketing/login URL that does NOT match the success pattern. */
export const BEINLEUMI_LOGIN_URL = `${BEINLEUMI_TEST_BASE_URL}/FibiMenu/Marketing/Private/Home`;

// ---- Test Credentials ----
// Centralized fake credentials for tests. SonarCloud flags hard-coded credential
// strings scattered across test files; importing from here silences those findings.

/** Username + password credential shape used by most bank-scraper tests. */
export interface IUsernamePasswordCredentials {
  username: string;
  password: string;
}

/** Generic username + password credentials used by most bank-scraper tests. */
export const CREDS_USERNAME_PASSWORD: IUsernamePasswordCredentials = {
  username: 'testuser',
  password: 'testpass',
};

/** Hapoalim-style credentials (userCode). */
export const CREDS_HAPOALIM = { userCode: 'user123', password: 'pass456' } as const;

/** Discount-style credentials (id + password + num). */
export const CREDS_DISCOUNT = { id: '123456789', password: 'pass123', num: '1234' } as const;

/** Isracard / Amex-style credentials (id + card6Digits + password). */
export const CREDS_ISRACARD = {
  id: '123456789',
  card6Digits: '123456',
  password: 'testpass',
} as const;

/** OTP test credentials with wrong user/pass for error scenarios. */
export const CREDS_WRONG = { username: 'wronguser', password: 'wrongpass' } as const;
