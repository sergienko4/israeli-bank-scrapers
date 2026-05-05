/**
 * Pepper credentials — bank-local credential shape.
 * Data only: no helpers, no validators. ApiMediator + handlers
 * validate as they consume. Matches the SCRAPERS entry in
 * src/Definitions.ts (phoneNumber + password + optional OTP).
 *
 * Brands: Each PII-bearing string is given a nominal Brand to keep
 * raw `string` from being assigned by mistake. Producers cast through
 * `as unknown as IPepperCreds` (see PepperShape.ts), so brands cost
 * nothing at the boundary.
 */

import type { Brand } from '../../Types/Brand.js';

/** International phone number (digits, no separators). */
type UserPhone = Brand<string, 'UserPhone'>;
/** 6-digit PIN / password. */
type UserPassword = Brand<string, 'UserPassword'>;
/** Persistent OTP token that short-circuits the SMS flow. */
type OtpLongTermToken = Brand<string, 'OtpLongTermToken'>;
/** One-time OTP code entered by the user. */
type OtpCode = Brand<string, 'OtpCode'>;

/** Credentials required to authenticate with Pepper. */
export interface IPepperCreds {
  readonly phoneNumber: UserPhone;
  readonly password: UserPassword;
  readonly otpLongTermToken?: OtpLongTermToken;
  readonly otpCodeRetriever?: () => Promise<OtpCode>;
}
