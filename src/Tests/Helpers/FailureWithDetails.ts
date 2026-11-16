/**
 * Test helper — build a failed Procedure carrying WAF error details.
 *
 * <p>Production only attaches details when it converts an existing failure; the
 * suites need the same shape to drive WAF-specific branches.
 */

import type { ScraperErrorTypes } from '../../Scrapers/Base/ErrorTypes.js';
import type { IWafErrorDetails } from '../../Scrapers/Base/Interfaces/WafErrorDetails.js';
import { some } from '../../Scrapers/Pipeline/Types/Option.js';
import type { IProcedureFailure } from '../../Scrapers/Pipeline/Types/Procedure.js';

/**
 * Build a failed Procedure with attached WAF details.
 * @param errorType - The categorized error type.
 * @param errorMessage - Human-readable error description.
 * @param details - WAF-specific error details.
 * @returns A failure Procedure with error details.
 */
function failureWithDetails(
  errorType: ScraperErrorTypes,
  errorMessage: string,
  details: IWafErrorDetails,
): IProcedureFailure {
  const errorDetails = some(details);
  return { success: false, errorType, errorMessage, errorDetails };
}

export default failureWithDetails;
