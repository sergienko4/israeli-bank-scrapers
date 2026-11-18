import { type CompanyTypes, type ScraperProgressTypes } from '../../Definitions.js';
import type { VoidResult } from './Interfaces/CallbackTypes.js';
import type { IScraperScrapingResult } from './Interfaces/ScraperScrapingResult.js';

export type { IErrorResult } from './Interfaces/ErrorResult.js';
export type { IScraperScrapingResult } from './Interfaces/ScraperScrapingResult.js';
export type { IWafErrorDetails } from './Interfaces/WafErrorDetails.js';

// This union type exists because the scraper 'factory' returns a generic interface.
// Refactor when the factory returns concrete scraper types instead.
/**
 * Payload passed to ScraperOptions.onAuthFlowComplete. longTermToken
 * is a nonempty string when the callback fires: the reusable seed
 * (persist + feed back as creds.otpLongTermToken next run). bearer is
 * the session token installed on the mediator; it is '' for a bank
 * whose session is a cookie (auth scheme 'none').
 */
export interface IAuthFlowInfo {
  readonly longTermToken: string;
  readonly bearer: string;
}

/**
 * Contract for the credential-side `otpCodeRetriever`.
 *
 * <p>By default the library calls it **at most once per login attempt**, even
 * when the bank's login chain submits the code in several requests (PayBox
 * submits it to both `/pinValidation` and `/loginBySms`). Implementations may
 * therefore be single-shot — consuming the inbound SMS, chat message or push
 * prompt — without needing their own cache.
 *
 * <p>One documented opt-out exists: a step declaring
 * `preHook.reuse: 'per-step'` acquires afresh, so a retriever CAN be called
 * again within the same flow. That is reserved for a bank that genuinely
 * delivers a distinct secret per step (Hapoalim's device step-up).
 *
 * <p>It IS called again for a genuinely new code when a login is retried after
 * the bank rejects the previous one.
 */

/**
 * Bank credentials. The public boundary checks the bank's required fields and
 * length caps before enrichment or any request: ordinary fields 1–256 chars,
 * `deviceSignature` ≤8192, `otpLongTermToken` ≤16384. A violation returns a
 * `GENERIC` failure naming the field, never its value.
 */
export type ScraperCredentials =
  | { userCode: string; password: string }
  | {
      userCode: string;
      password: string;
      otpCodeRetriever?: (phoneHint: string) => Promise<string>;
      otpLongTermToken?: string;
      deviceSignature?: string;
    } // Hapoalim: the SMS code when the bank asks; a stored session skips the login steps; deviceSignature overrides the per-user identity derived from the seed in otpLongTermToken
  | { username: string; password: string }
  | { username: string; password: string; otpLongTermToken?: string } // VisaCal: a stored login hash skips the password step
  | { username: string; password: string; id: string } // Max: second-login flow with ID (ת.ז.)
  | { id: string; password: string }
  | { id: string; password: string; num: string }
  | { id: string; password: string; card6Digits: string }
  | { id: string; password: string; card6Digits: string; otpLongTermToken?: string } // Isracard / Amex: a stored device key skips the login steps
  | { username: string; nationalID: string; password: string; otpLongTermToken?: string } // Yahav (legacy key): username == num
  | { num: string; nationalID: string; password: string; otpLongTermToken?: string } // Yahav (pipeline): user code (num) + ת.ז.; num accepts legacy `username`; a stored device registration skips the enrolment steps
  | ({ email: string; password: string } & (
      | {
          otpCodeRetriever: () => Promise<string>;
          phoneNumber: string;
        }
      | {
          otpLongTermToken: string;
        }
    ))
  | ({ phoneNumber: string; password: string } & (
      | {
          otpCodeRetriever: () => Promise<string>;
        }
      | {
          otpLongTermToken: string;
        }
    ));

interface IScraperOptions {
  /**
   * The company you want to scrape
   */
  companyId: CompanyTypes;

  /**
   * The date to fetch transactions from. Must be a valid `Date`; an invalid
   * value fails before enrichment or any bank request.
   */
  startDate: Date;

  /**
   * Scrape transactions to be processed X months in the future. An integer
   * from 0 to 24; out-of-range values fail before any bank request.
   * @default 1
   */
  futureMonthsToScrape?: number;

  /**
   * Called when the bank's authentication API requests an OTP/2FA code.
   * Return the one-time code to continue scraping automatically.
   *
   * Called at most once per successful acquisition per login attempt — see the
   * `otpCodeRetriever` contract note above `ScraperCredentials`. A single-shot
   * implementation (one SMS in, one code out) is sufficient for most banks.
   * Hapoalim's device step-up asks for a second, distinct code in the same
   * login, so its callback is invoked again; implementations must answer both
   * prompts. An acquisition that rejects is not cached, so a retry re-prompts.
   * A step config may opt out of the once-per-login cache with
   * `preHook.reuse: 'per-step'`; Hapoalim uses it for the device step-up.
   * @param phoneHint masked phone number reported by the bank, e.g. "*******1200" (empty string if none)
   */
  otpCodeRetriever?: (phoneHint: string) => Promise<string>;

  /**
   * Invoked once by API-DIRECT-CALL banks after a successful auth flow
   * (either warm or cold path) to surface the captured long-term token
   * + bearer for caller-managed caching. Receiving a nonempty
   * longTermToken means the caller may persist it and pass it back as
   * creds.otpLongTermToken on the next run to skip the SMS steps.
   * Callback errors are logged and swallowed; scrape success is preserved.
   */
  onAuthFlowComplete?: (info: IAuthFlowInfo) => void | Promise<void>;

  /**
   * Opaque, versioned device-auth state previously emitted by
   * onPersistentAuthStateUpdate. Banks without durable device auth ignore it.
   *
   * <p>The value is encoded, not encrypted: depending on the bank it may carry
   * a bearer token and a device private key, so callers must store it as a
   * secret. Requires onPersistentAuthStateUpdate and must not be combined
   * with creds.otpLongTermToken. Omit it when nothing is stored: an empty
   * string is rejected as invalid state. Values over 32,768 characters fail
   * before any bank request; the bound matches the codec envelope.
   */
  persistentAuthState?: string;

  /**
   * Persists replacement device-auth state for banks that support durable
   * device authentication. Banks without durable device auth ignore it.
   *
   * <p>Runs once after a successful durable enrollment or expired-state
   * renewal, never for a fresh replay or a failed flow, and is never retried.
   * Resolution acknowledges durable storage; rejection or throw fails
   * authentication before the new bearer is used. Durable mode never invokes
   * onAuthFlowComplete or populates persistentOtpToken.
   */
  onPersistentAuthStateUpdate?: (state: string) => Promise<void>;

  /**
   * Maximum time (ms) to wait for the OTP code from the retriever callback.
   * If the retriever doesn't resolve within this window, the phase fails with OTP_TIMEOUT.
   * @default 180000 (3 minutes)
   */
  otpTimeoutMs?: number;

  /**
   * Aborts the scrape when this signal fires. In-flight requests receive the
   * same signal, and no further phase starts after it aborts.
   */
  signal?: AbortSignal;

  /**
   * Whole-run deadline in milliseconds, measured from the start of the
   * execution. Equivalent to aborting a signal after this delay.
   */
  deadlineMs?: number;

  /**
   * Maximum time (ms) to wait for `onAuthFlowComplete` and
   * `onPersistentAuthStateUpdate`. A callback that exceeds it is treated as a
   * throw: the auth-flow callback is logged and swallowed, and a durable-state
   * update fails authentication before its bearer is used. A timed-out callback
   * is not cancelled: it may still complete, so implementations must make
   * storage writes idempotent and ignore a write older than the newest token
   * they have stored.
   * @default 30000 (30 seconds)
   */
  callbackTimeoutMs?: number;

  /**
   * Login chain log verbosity.
   * - 'info' (default): chain plan, step pass/fail with timing, masked result summary.
   * - 'trace': all of info plus per-step HTTP request context.
   * Falls back to LOG_LEVEL env var when not set.
   */
  loginLogLevel?: 'info' | 'trace';
}

export type ScraperOptions = IScraperOptions;

export interface IScraper<TCredentials extends ScraperCredentials> {
  scrape(credentials: TCredentials): Promise<IScraperScrapingResult>;
  onProgress(
    func: (companyId: CompanyTypes, payload: { type: ScraperProgressTypes }) => VoidResult,
  ): VoidResult;
}

/**
 * Backward-compatible alias for IScraper. Prefer IScraper for new code.
 */
export type Scraper<TCredentials extends ScraperCredentials = ScraperCredentials> =
  IScraper<TCredentials>;

/**
 * Backward-compatible alias for IScraperScrapingResult. Prefer IScraperScrapingResult for new code.
 */
export type ScraperScrapingResult = IScraperScrapingResult;
