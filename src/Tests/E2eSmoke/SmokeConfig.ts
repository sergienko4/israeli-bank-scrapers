import { CompanyTypes } from '../../Definitions.js';
import type { ScraperCredentials } from '../../Scrapers/Base/Interface.js';
import {
  INVALID_CREDS_DISCOUNT,
  INVALID_CREDS_HAPOALIM,
  INVALID_CREDS_ID_PASSWORD,
  INVALID_CREDS_ISRACARD_AMEX,
  INVALID_CREDS_ONEZERO,
  INVALID_CREDS_USERNAME_PASSWORD,
  INVALID_CREDS_YAHAV,
} from '../TestConstants.js';

/** Per-bank invalid credential configuration for smoke tests. */
export interface IBankSmokeConfig {
  readonly companyId: CompanyTypes;
  readonly displayName: string;
  readonly credentials: ScraperCredentials;
  readonly defaultTimeout?: number;
}

/** Local re-export for clarity in the SMOKE_BANKS list. */
const USER_PASS: ScraperCredentials = INVALID_CREDS_USERNAME_PASSWORD;
const ID_PASS_NUM: ScraperCredentials = INVALID_CREDS_DISCOUNT;
const ID_CARD_PASS: ScraperCredentials = INVALID_CREDS_ISRACARD_AMEX;

/**
 * All banks with invalid credentials for smoke testing.
 * Each entry exercises: browser launch, WAF bypass, navigation, form fill, error detection.
 */
export const SMOKE_BANKS: readonly IBankSmokeConfig[] = [
  {
    companyId: CompanyTypes.Hapoalim,
    displayName: 'Hapoalim',
    credentials: INVALID_CREDS_HAPOALIM,
  },
  { companyId: CompanyTypes.Leumi, displayName: 'Leumi', credentials: USER_PASS },
  { companyId: CompanyTypes.Mizrahi, displayName: 'Mizrahi', credentials: USER_PASS },
  { companyId: CompanyTypes.Max, displayName: 'Max', credentials: USER_PASS },
  { companyId: CompanyTypes.Isracard, displayName: 'Isracard', credentials: ID_CARD_PASS },
  {
    companyId: CompanyTypes.Amex,
    displayName: 'Amex',
    credentials: ID_CARD_PASS,
    defaultTimeout: 60000,
  },
  { companyId: CompanyTypes.VisaCal, displayName: 'VisaCal', credentials: USER_PASS },
  { companyId: CompanyTypes.Discount, displayName: 'Discount', credentials: ID_PASS_NUM },
  { companyId: CompanyTypes.OtsarHahayal, displayName: 'Otsar Hahayal', credentials: USER_PASS },
  { companyId: CompanyTypes.Beinleumi, displayName: 'Beinleumi', credentials: USER_PASS },
  { companyId: CompanyTypes.Mercantile, displayName: 'Mercantile', credentials: ID_PASS_NUM },
  { companyId: CompanyTypes.Massad, displayName: 'Massad', credentials: USER_PASS },
  {
    companyId: CompanyTypes.Yahav,
    displayName: 'Yahav',
    credentials: INVALID_CREDS_YAHAV,
  },
  {
    companyId: CompanyTypes.BeyahadBishvilha,
    displayName: 'Beyahad Bishvilha',
    credentials: INVALID_CREDS_ID_PASSWORD,
  },
  {
    companyId: CompanyTypes.Behatsdaa,
    displayName: 'Behatsdaa',
    credentials: INVALID_CREDS_ID_PASSWORD,
  },
  { companyId: CompanyTypes.Pagi, displayName: 'Pagi', credentials: USER_PASS },
  {
    companyId: CompanyTypes.OneZero,
    displayName: 'OneZero',
    credentials: INVALID_CREDS_ONEZERO,
  },
] as const;
