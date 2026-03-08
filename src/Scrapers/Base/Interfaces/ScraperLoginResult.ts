import type { ScraperErrorTypes } from '../ErrorTypes.js';
import type { WafErrorDetails } from './WafErrorDetails.js';

export interface ScraperLoginResult {
  success: boolean;
  errorType?: ScraperErrorTypes;
  errorMessage?: string; // only on success=false
  errorDetails?: WafErrorDetails; // only on errorType=WAF_BLOCKED
  persistentOtpToken?: string;
}
