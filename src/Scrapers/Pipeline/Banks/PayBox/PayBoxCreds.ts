/**
 * PayBox credentials — bank-local credential shape.
 *
 * Data only: no helpers, no validators. ApiMediator + handlers
 * validate as they consume. Matches the SCRAPERS entry in
 * `src/Definitions.ts` (phoneNumber + OTP).
 *
 * Brands: each PII-bearing string is given a nominal Brand to keep
 * raw `string` from being assigned by mistake. Producers cast through
 * `as unknown as IPayBoxCreds`; brands cost nothing at the boundary.
 *
 * The flow is SMS-OTP only — there is NO password field. PayBox does
 * not have a static-password login surface; the user always enters a
 * fresh OTP delivered via SMS. The optional `otpLongTermToken`
 * short-circuits the SMS flow on warm runs (token has a 2-year TTL).
 *
 * `deviceId16Hex` is NOT exposed on creds — it is derived
 * deterministically from `phoneNumber` via the
 * `seedCarryFromCreds[kind: 'sha256-prefix-16']` bootstrap so the
 * caller never has to persist it alongside the long-term token.
 */

import type { Brand } from '../../Types/Brand.js';

/** International phone number (digits, no separators). */
type UserPhone = Brand<string, 'PayBoxUserPhone'>;
/** Persistent JWT that short-circuits the SMS flow (2-year TTL). */
type OtpLongTermToken = Brand<string, 'PayBoxOtpLongTermToken'>;
/** One-time OTP code entered by the user. */
type OtpCode = Brand<string, 'PayBoxOtpCode'>;

/** Credentials required to authenticate with PayBox. */
export interface IPayBoxCreds {
  readonly phoneNumber: UserPhone;
  readonly otpLongTermToken?: OtpLongTermToken;
  readonly otpCodeRetriever?: () => Promise<OtpCode>;
}
