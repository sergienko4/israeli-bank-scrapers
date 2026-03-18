/**
 * Pipeline executor — reduces over phases, short-circuits on failure.
 * Stub: returns { success: true } until Step 2.
 */

import type { IScraperScrapingResult, ScraperCredentials } from '../Base/Interface.js';
import type { IPipelineDescriptor } from './PipelineDescriptor.js';

/**
 * Execute a pipeline descriptor against credentials.
 * @param descriptor - The pipeline to execute.
 * @param credentials - User bank credentials.
 * @returns Legacy result shape for backward compatibility.
 */
function executePipeline(
  descriptor: IPipelineDescriptor,
  credentials: ScraperCredentials,
): Promise<IScraperScrapingResult> {
  const phaseCount = String(descriptor.phases.length);
  const credKeys = String(Object.keys(credentials).length);
  const stubInfo = `Pipeline stub: ${phaseCount} phases, ${credKeys} credential keys`;
  return Promise.resolve({ success: true, errorMessage: stubInfo });
}

export default executePipeline;
export { executePipeline };
