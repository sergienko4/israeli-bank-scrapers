/**
 * OneZero credentials — bank-local credential shape.
 * Data only: no helpers, no validators. ApiMediator + handlers
 * validate as they consume.
 *
 * Brands: Each PII-bearing string is given a nominal Brand to keep
 * raw `string` from being assigned by mistake. Producers cast through
 * `as unknown as IOneZeroCreds`, so brands cost nothing at the boundary.
 */

import type { Brand } from '../../Types/Brand.js';

/** User login email address. */
type UserEmail = Brand<string, 'UserEmail'>;
/** User login password. */
type UserPassword = Brand<string, 'UserPassword'>;
/** International phone number (digits, no separators). */
type UserPhone = Brand<string, 'UserPhone'>;
/** Persistent SMS-OTP token that short-circuits the SMS flow. */
type OtpLongTermToken = Brand<string, 'OtpLongTermToken'>;
/** One-time OTP code entered by the user. */
type OtpCode = Brand<string, 'OtpCode'>;

/** Credentials required to authenticate with OneZero. */
export interface IOneZeroCreds {
  readonly email: UserEmail;
  readonly password: UserPassword;
  readonly phoneNumber?: UserPhone;
  readonly otpLongTermToken?: OtpLongTermToken;
  readonly otpCodeRetriever?: () => Promise<OtpCode>;
}
