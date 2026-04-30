/**
 * Pepper credentials — bank-local credential shape.
 * Data only: no helpers, no validators. ApiMediator + handlers
 * validate as they consume. Matches the SCRAPERS entry in
 * src/Definitions.ts (phoneNumber + password + optional OTP).
 */

/** International phone number (digits, no separators). */
type UserPhone = string;
/** 6-digit PIN / password. */
type UserPassword = string;
/** Persistent OTP token that short-circuits the SMS flow. */
type OtpLongTermToken = string;
/** One-time OTP code entered by the user. */
type OtpCode = string;

/** Credentials required to authenticate with Pepper. */
export interface IPepperCreds {
  readonly phoneNumber: UserPhone;
  readonly password: UserPassword;
  readonly otpLongTermToken?: OtpLongTermToken;
  readonly otpCodeRetriever?: () => Promise<OtpCode>;
}
