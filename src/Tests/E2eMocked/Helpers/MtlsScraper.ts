/**
 * Build the normal bank scraper, then attach a per-execution mTLS transport
 * to its descriptor. Mocked suites use this instead of a process-wide setter:
 * the fallback exists only for the scrape that received it.
 */

import type {
  IScraper,
  ScraperCredentials,
  ScraperOptions,
} from '../../../Scrapers/Base/Interface.js';
import ScraperError from '../../../Scrapers/Base/ScraperError.js';
import PIPELINE_REGISTRY from '../../../Scrapers/Pipeline/Banks/PipelineRegistry.js';
import type { IPipelineDescriptor } from '../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';
import PipelineScraper from '../../../Scrapers/Pipeline/Core/PipelineScraper.js';
import type { IMtlsInvokeOptions } from '../../../Scrapers/Pipeline/Types/Domain/MtlsInvokeTypes.js';
import { isOk, type Procedure, succeed } from '../../../Scrapers/Pipeline/Types/Procedure.js';

/**
 * Create a scraper whose descriptor carries the given mTLS settings.
 * @param options - Normal scraper options.
 * @param mtls - Per-execution fallback and timeout.
 * @returns A scraper that uses the injected mTLS transport.
 */
export default function createScraperWithMtls(
  options: ScraperOptions,
  mtls: IMtlsInvokeOptions,
): IScraper<ScraperCredentials> {
  const factory = PIPELINE_REGISTRY[options.companyId];
  if (factory === undefined) throw new ScraperError(`unknown company id ${options.companyId}`);
  /**
   * Build the bank descriptor, adding the per-execution mTLS settings.
   * @param opts - Scraper options.
   * @returns The descriptor, or the bank's build failure.
   */
  const build = (opts: ScraperOptions): Procedure<IPipelineDescriptor> => {
    const descriptor = factory(opts);
    if (!isOk(descriptor)) return descriptor;
    return succeed({ ...descriptor.value, mtls });
  };
  return new PipelineScraper(options, build);
}
