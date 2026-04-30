/**
 * OneZero credentials — bank-local credential shape.
 * Data only: no helpers, no validators. ApiMediator + handlers
 * validate as they consume.
 */

/** User login email address. */
type UserEmail = string;
/** User login password. */
type UserPassword = string;
/** International phone number (digits, no separators). */
type UserPhone = string;
/** Persistent SMS-OTP token that short-circuits the SMS flow. */
type OtpLongTermToken = string;
/** One-time OTP code entered by the user. */
type OtpCode = string;

/** Credentials required to authenticate with OneZero. */
export interface IOneZeroCreds {
  readonly email: UserEmail;
  readonly password: UserPassword;
  readonly phoneNumber?: UserPhone;
  readonly otpLongTermToken?: OtpLongTermToken;
  readonly otpCodeRetriever?: () => Promise<OtpCode>;
}
