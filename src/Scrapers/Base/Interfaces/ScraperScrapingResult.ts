import type { ITransactionsAccount } from '../../../Transactions.js';
import type { ScraperErrorTypes } from '../ErrorTypes.js';
import type { IFutureDebit } from './FutureDebit.js';
import type { IScraperDiagnostics } from './ScraperDiagnostics.js';
import type { IWafErrorDetails } from './WafErrorDetails.js';

export interface IScraperScrapingResult {
  success: boolean;
  accounts?: ITransactionsAccount[];
  futureDebits?: IFutureDebit[];
  errorType?: ScraperErrorTypes;
  errorMessage?: string; // only on success=false
  errorDetails?: IWafErrorDetails; // only on errorType=WAF_BLOCKED
  /** Long-term OTP token returned by banks that support it (e.g. OneZero).
   *  Save and pass as credentials.otpLongTermToken to skip SMS on future runs. */
  persistentOtpToken?: string;
  diagnostics?: IScraperDiagnostics;
}
