import { CompanyTypes } from '../../Definitions.js';
import type { ScraperCredentials } from '../../Scrapers/Base/Interface.js';

/** Per-bank invalid credential configuration for smoke tests. */
export interface IBankSmokeConfig {
  readonly companyId: CompanyTypes;
  readonly displayName: string;
  readonly credentials: ScraperCredentials;
  readonly defaultTimeout?: number;
}

/** Invalid credentials for username+password banks. */
const USER_PASS: ScraperCredentials = { username: 'INVALID_USER', password: 'invalid123' };

/** Invalid credentials for ID+password+num banks. */
const ID_PASS_NUM: ScraperCredentials = { id: '000000000', password: 'invalid123', num: '000000' };

/** Invalid credentials for ID+card6+password banks (Isracard/Amex). */
const ID_CARD_PASS: ScraperCredentials = {
  id: '000000000',
  card6Digits: '000000',
  password: 'InvalidPass1',
};

/**
 * All banks with invalid credentials for smoke testing.
 * Each entry exercises: browser launch, WAF bypass, navigation, form fill, error detection.
 */
export const SMOKE_BANKS: readonly IBankSmokeConfig[] = [
  {
    companyId: CompanyTypes.Hapoalim,
    displayName: 'Hapoalim',
    credentials: { userCode: 'INVALID_USER', password: 'invalid123' },
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
    credentials: { username: 'INVALID_USER', nationalID: '000000000', password: 'invalid123' },
  },
  {
    companyId: CompanyTypes.BeyahadBishvilha,
    displayName: 'Beyahad Bishvilha',
    credentials: { id: '000000000', password: 'invalid123' },
  },
  {
    companyId: CompanyTypes.Behatsdaa,
    displayName: 'Behatsdaa',
    credentials: { id: '000000000', password: 'invalid123' },
  },
  { companyId: CompanyTypes.Pagi, displayName: 'Pagi', credentials: USER_PASS },
  {
    companyId: CompanyTypes.OneZero,
    displayName: 'OneZero',
    credentials: {
      email: 'invalid@example.com',
      password: 'invalid123',
      otpLongTermToken: 'invalid-token',
    },
  },
] as const;
