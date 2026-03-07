import type { ScraperErrorTypes } from '../../Scrapers/Base/ErrorTypes';
import type { ITransactionsAccount } from '../../Transactions';
import type { IWafErrorDetails } from '../Error/WafErrorDetails';
import type { IFutureDebit } from '../Transaction/FutureDebit';
import type { IScraperDiagnostics } from './ScraperDiagnostics';

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
