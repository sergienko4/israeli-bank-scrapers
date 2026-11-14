/**
 * OTP timing budget. Split out of the TimingConfig barrel, which was retired
 * once every importer moved to a domain file.
 */

/**
 * OTP user entry budget (ms) the sms-otp pre-hook applies when the credentials
 * carry no `otpTimeoutMs`. The real-bank test poller (`E2eReal/OtpPoller.ts`)
 * mirrors it so it never gives up before the flow does.
 */
const DEFAULT_OTP_TIMEOUT_MS = 180_000;

export default DEFAULT_OTP_TIMEOUT_MS;
