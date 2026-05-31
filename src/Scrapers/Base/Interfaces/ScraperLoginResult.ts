import type { ScraperErrorTypes } from '../ErrorTypes.js';
import type { IWafErrorDetails } from './WafErrorDetails.js';

export interface IScraperLoginResult {
  success: boolean;
  errorType?: ScraperErrorTypes;
  errorMessage?: string; // only on success=false
  errorDetails?: IWafErrorDetails; // only on errorType=WAF_BLOCKED
  persistentOtpToken?: string;
}
