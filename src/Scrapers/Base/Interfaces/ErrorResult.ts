import type { ScraperErrorTypes } from '../ErrorTypes.js';
import type { WafErrorDetails } from './WafErrorDetails.js';

export interface ErrorResult {
  success: false;
  errorType: ScraperErrorTypes;
  errorMessage: string;
  errorDetails?: WafErrorDetails;
}
