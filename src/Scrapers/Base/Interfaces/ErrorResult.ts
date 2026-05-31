import type { ScraperErrorTypes } from '../ErrorTypes.js';
import type { IWafErrorDetails } from './WafErrorDetails.js';

export interface IErrorResult {
  success: false;
  errorType: ScraperErrorTypes;
  errorMessage: string;
  errorDetails?: IWafErrorDetails;
}
