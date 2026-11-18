import type { ScraperErrorTypes } from '../ErrorTypes.js';
import type { IWafErrorDetails } from './WafErrorDetails.js';

export interface IErrorResult {
  success: false;
  errorType: ScraperErrorTypes;
  errorMessage: string;
  /**
   * Structured WAF details, when a legacy result carries them.
   * @deprecated Never produced by the pipeline; retained for source
   * compatibility. Read `errorType` and `errorMessage` instead.
   */
  errorDetails?: IWafErrorDetails;
}
