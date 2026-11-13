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
 * delivers a distinct secret per step; no bank declares it today.
 *
 * <p>It IS called again for a genuinely new code when a login is retried after
 * the bank rejects the previous one.
 */

export type ScraperCredentials =
  | { userCode: string; password: string }
  | {
      userCode: string;
      password: string;
      otpCodeRetriever?: (phoneHint: string) => Promise<string>;
      otpLongTermToken?: string;
      deviceSignature?: string;
    } // Hapoalim: the SMS code when the bank asks; a stored session skips the login steps; deviceSignature overrides the shipped app device signature
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
   * the date to fetch transactions from (can't be before the minimum allowed time difference for the scraper)
   */
  startDate: Date;

  /**
   * scrape transactions to be processed X months in the future
   */
  futureMonthsToScrape?: number;

  /**
   * Called when the bank's authentication API requests an OTP/2FA code.
   * Return the one-time code to continue scraping automatically.
   *
   * Called at most once per successful acquisition per login attempt — see the
   * `otpCodeRetriever` contract note above `ScraperCredentials`. A single-shot
   * implementation (one SMS in, one code out) is sufficient for every bank
   * shipped today. Two documented exceptions can call it again within one
   * login: an acquisition that rejects is not cached, so a retry re-prompts;
   * and a step config may opt out with `preHook.reuse: 'per-step'`, which no
   * bank currently does.
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
   * string is rejected as invalid state.
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
