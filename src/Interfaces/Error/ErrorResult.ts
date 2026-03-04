import type { ScraperErrorTypes } from '../../Scrapers/Base/ErrorTypes';
import type { WafErrorDetails } from './WafErrorDetails';

export interface ErrorResult {
  success: false;
  errorType: ScraperErrorTypes;
  errorMessage: string;
  errorDetails?: WafErrorDetails;
}
