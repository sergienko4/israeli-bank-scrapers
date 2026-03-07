import type { ScraperErrorTypes } from '../../Scrapers/Base/ErrorTypes';
import type { IWafErrorDetails } from '../Error/WafErrorDetails';

export interface IScraperLoginResult {
  success: boolean;
  errorType?: ScraperErrorTypes;
  errorMessage?: string; // only on success=false
  errorDetails?: IWafErrorDetails; // only on errorType=WAF_BLOCKED
  persistentOtpToken?: string;
}
