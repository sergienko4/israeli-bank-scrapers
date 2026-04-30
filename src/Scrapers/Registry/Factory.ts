import { type CompanyTypes } from '../../Definitions.js';
import { type IScraper, type ScraperCredentials, type ScraperOptions } from '../Base/Interface.js';
import ScraperError from '../Base/ScraperError.js';
import { PIPELINE_REGISTRY } from '../Pipeline/Core/PipelineRegistry.js';
import { PipelineScraper } from '../Pipeline/Core/PipelineScraper.js';
import SCRAPER_REGISTRY_AMEX_TO_ISRACARD, {
  type ScraperFactory,
} from './ScraperRegistryAmexToIsracard.js';
import SCRAPER_REGISTRY_LEUMI_TO_YAHAV from './ScraperRegistryLeumiToYahav.js';

/** Combined registry of all supported bank scrapers (legacy). */
const SCRAPER_REGISTRY: Partial<Record<CompanyTypes, ScraperFactory>> = {
  ...SCRAPER_REGISTRY_AMEX_TO_ISRACARD,
  ...SCRAPER_REGISTRY_LEUMI_TO_YAHAV,
};

/**
 * Try creating a pipeline scraper for banks registered in PIPELINE_REGISTRY.
 * @param options - Scraper configuration.
 * @returns A PipelineScraper if registered, false otherwise.
 */
function tryPipeline(options: ScraperOptions): IScraper<ScraperCredentials> | false {
  const pipelineFactory = PIPELINE_REGISTRY[options.companyId];
  if (!pipelineFactory) return false;
  return new PipelineScraper(options, pipelineFactory);
}

/**
 * Create a scraper instance for the given company.
 * Pipeline-first: if the bank is in PIPELINE_REGISTRY, returns a PipelineScraper
 * regardless of the usePipeline flag. Falls back to the legacy registry otherwise.
 * @param options - Scraper configuration including company ID and credentials.
 * @returns A scraper instance ready to scrape transactions.
 */
export default function createScraper(options: ScraperOptions): IScraper<ScraperCredentials> {
  const pipelineScraper = tryPipeline(options);
  if (pipelineScraper) return pipelineScraper;
  const factory = SCRAPER_REGISTRY[options.companyId];
  if (factory) return factory(options);
  throw new ScraperError(`unknown company id ${options.companyId}`);
}
