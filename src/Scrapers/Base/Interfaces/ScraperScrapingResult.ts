import type { TransactionsAccount } from '../../../Transactions';
import type { ScraperErrorTypes } from '../ErrorTypes';
import type { FutureDebit } from './FutureDebit';
import type { ScraperDiagnostics } from './ScraperDiagnostics';
import type { WafErrorDetails } from './WafErrorDetails';

export interface ScraperScrapingResult {
  success: boolean;
  accounts?: TransactionsAccount[];
  futureDebits?: FutureDebit[];
  errorType?: ScraperErrorTypes;
  errorMessage?: string; // only on success=false
  errorDetails?: WafErrorDetails; // only on errorType=WAF_BLOCKED
  /** Long-term OTP token returned by banks that support it (e.g. OneZero).
   *  Save and pass as credentials.otpLongTermToken to skip SMS on future runs. */
  persistentOtpToken?: string;
  diagnostics?: ScraperDiagnostics;
}
