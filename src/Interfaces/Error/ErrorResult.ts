import type { ScraperErrorTypes } from '../../Scrapers/Base/ErrorTypes';
import type { IWafErrorDetails } from './WafErrorDetails';

export interface IErrorResult {
  success: false;
  errorType: ScraperErrorTypes;
  errorMessage: string;
  errorDetails?: IWafErrorDetails;
}
