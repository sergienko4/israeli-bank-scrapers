import type { ITransactionsAccount } from '../../../Transactions.js';
import type { ScraperErrorTypes } from '../ErrorTypes.js';
import type { IFutureDebit } from './FutureDebit.js';
import type { IScraperDiagnostics } from './ScraperDiagnostics.js';
import type { IWafErrorDetails } from './WafErrorDetails.js';

export interface IScraperScrapingResult {
  success: boolean;
  accounts?: ITransactionsAccount[];
  /**
   * Upcoming debits.
   *
   * <p><b>Never populated.</b> The field is part of the upstream result shape
   * and is kept so the type stays compatible, but no scraper in this package
   * writes to it. An empty or absent value means "not available", not "this
   * account has no upcoming debits" — treating it as the latter would read a
   * gap in the implementation as a fact about someone's money.
   */
  futureDebits?: IFutureDebit[];
  errorType?: ScraperErrorTypes;
  errorMessage?: string; // only on success=false
  errorDetails?: IWafErrorDetails; // only on errorType=WAF_BLOCKED
  /** Long-term OTP token returned by banks that support it (e.g. OneZero).
   *  Save and pass as credentials.otpLongTermToken to skip SMS on future runs. */
  persistentOtpToken?: string;
  /**
   * Per-run diagnostics.
   *
   * <p>Populated by the browser-based scrapers only. The API-direct pipeline
   * does not extend the base scraper that builds this, and reports what it
   * knows through `ITransactionsAccount.windowCoverage` instead.
   */
  diagnostics?: IScraperDiagnostics;
}
