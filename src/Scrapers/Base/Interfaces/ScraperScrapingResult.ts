import type { ITransactionsAccount } from '../../../Transactions.js';
import type { ScraperErrorTypes } from '../ErrorTypes.js';
import type { IWafErrorDetails } from './WafErrorDetails.js';

export interface IScraperScrapingResult {
  success: boolean;
  accounts?: ITransactionsAccount[];
  errorType?: ScraperErrorTypes;
  errorMessage?: string; // only on success=false
  /**
   * Structured WAF details, when a legacy result carries them.
   * @deprecated Never produced by the pipeline; retained for source
   * compatibility. Read `errorType` and `errorMessage` instead.
   */
  errorDetails?: IWafErrorDetails;
  /** Long-term OTP token returned by banks that support it (e.g. OneZero).
   *  Save and pass as credentials.otpLongTermToken to skip SMS on future runs. */
  persistentOtpToken?: string;
}
