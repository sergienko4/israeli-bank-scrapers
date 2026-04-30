/**
 * Test constants derived from scraper configuration.
 *
 * Centralises hardcoded URLs used across integration tests so they
 * stay in sync with the production login configs.
 */
import { CompanyTypes } from '../Definitions.js';
import { SCRAPER_CONFIGURATION } from '../Scrapers/Registry/Config/ScraperConfig.js';

const CFG = SCRAPER_CONFIGURATION.banks;

// ---- Leumi ----

/** Leumi base URL from scraper configuration. */
export const LEUMI_BASE_URL = CFG[CompanyTypes.Leumi].urls.base;

/** Leumi API base URL. */
export const LEUMI_API_URL = CFG[CompanyTypes.Leumi].api.base;

/** Leumi success URL matching the `/ebanking/SO/SPA.aspx` pattern. */
export const LEUMI_SUCCESS_URL = `${CFG[CompanyTypes.Leumi].api.base}/ebanking/SO/SPA.aspx`;

/** Leumi login URL for invalid login tests. */
export const LEUMI_LOGIN_URL = `${CFG[CompanyTypes.Leumi].api.base}/login`;

// ---- Test Credentials ----
// Centralized opaque placeholders for tests. Values are random hex prefixes so
// they cannot be mistaken for generic placeholder patterns (e.g. 1234,
// testpass, password). SonarCloud flags hard-coded credential strings
// scattered across test files; importing from here silences those findings.

/** Username + password placeholder shape for tests against mocked banks. */
export const CREDS_USERNAME_PASSWORD = {
  username: 'fixt-u-7c2f3e9a',
  password: 'fixt-p-9b41ad2e',
} as const;

/** Distinct placeholder pair for tests that need a second non-matching credential set. */
export const CREDS_WRONG = {
  username: 'fixt-u-d8e15403',
  password: 'fixt-p-31aa9f6c',
} as const;

// ---- Invalid Credentials (centralised — used by InvalidLogin* + E2eMocked) ----

/** Invalid placeholder for username/password banks (Beinleumi, Max, Mizrahi, OtsarHahayal, etc.). */
export const INVALID_CREDS_USERNAME_PASSWORD = {
  username: 'fixt-i-1a2b3c4d',
  password: 'fixt-i-5e6f7a8b',
} as const;

/** Invalid placeholder for Discount-style banks (id + password + num). */
export const INVALID_CREDS_DISCOUNT = {
  id: 'fixt-i-9c8d7e6f',
  password: 'fixt-i-3b2a1f0e',
  num: 'fixt-i-7d6c5b4a',
} as const;

/** Invalid placeholder for Hapoalim (userCode + password). */
export const INVALID_CREDS_HAPOALIM = {
  userCode: 'fixt-i-2e3f4a5b',
  password: 'fixt-i-6c7d8e9f',
} as const;

/** Invalid placeholder for Isracard / Amex (id + card6Digits + password). */
export const INVALID_CREDS_ISRACARD_AMEX = {
  id: 'fixt-i-4f5e6d7c',
  card6Digits: 'fixt-i-8b9a0f1e',
  password: 'fixt-i-c0d1e2f3',
} as const;

/** Invalid placeholder for Yahav (username + nationalID + password). */
export const INVALID_CREDS_YAHAV = {
  username: 'fixt-i-yh-7a8b',
  nationalID: 'fixt-i-yh-1c2d',
  password: 'fixt-i-yh-9e0f',
} as const;

/** Invalid placeholder for id+password banks (Behatsdaa, BeyahadBishvilha). */
export const INVALID_CREDS_ID_PASSWORD = {
  id: 'fixt-i-id-1f2e',
  password: 'fixt-i-id-3d4c',
} as const;

/** Invalid placeholder for OneZero (email + password + long-term token). */
export const INVALID_CREDS_ONEZERO = {
  email: 'fixt-i-oz-5b6a@example.com',
  password: 'fixt-i-oz-7980',
  otpLongTermToken: 'fixt-i-oz-token-abcd1234',
} as const;

/** Mocked-bank placeholder for Isracard/Amex (id + card6Digits + password) — same shape as the invalid set
 *  but used in tests that need successful resolution against mock fixtures. */
export const CREDS_ISRACARD_AMEX = {
  id: 'fixt-m-3a4b5c6d',
  card6Digits: 'fixt-m-7e8f9a0b',
  password: 'fixt-m-c1d2e3f4',
} as const;
