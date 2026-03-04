import type { ScraperErrorTypes } from '../../Scrapers/Base/ErrorTypes';
import type { WafErrorDetails } from '../Error/WafErrorDetails';

export interface ScraperLoginResult {
  success: boolean;
  errorType?: ScraperErrorTypes;
  errorMessage?: string; // only on success=false
  errorDetails?: WafErrorDetails; // only on errorType=WAF_BLOCKED
  persistentOtpToken?: string;
}
