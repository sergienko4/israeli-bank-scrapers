import { type IScraper, type ScraperCredentials, type ScraperOptions } from '../Base/Interface.js';
import ScraperError from '../Base/ScraperError.js';
import PIPELINE_REGISTRY from '../Pipeline/Banks/PipelineRegistry.js';
import { PipelineScraper } from '../Pipeline/Core/PipelineScraper.js';

/**
 * Create a scraper instance for the given company.
 *
 * <p>Every supported bank resolves through PIPELINE_REGISTRY.
 * @param options - Scraper configuration including company ID and credentials.
 * @returns A scraper instance ready to scrape transactions.
 * @throws ScraperError when the company id is not registered.
 */
export default function createScraper(options: ScraperOptions): IScraper<ScraperCredentials> {
  const pipelineFactory = PIPELINE_REGISTRY[options.companyId];
  if (!pipelineFactory) throw new ScraperError(`unknown company id ${options.companyId}`);
  return new PipelineScraper(options, pipelineFactory);
}
