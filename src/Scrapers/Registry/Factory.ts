import { type CompanyTypes } from '../../Definitions.js';
import { type IScraper, type ScraperCredentials, type ScraperOptions } from '../Base/Interface.js';
import ScraperError from '../Base/ScraperError.js';
import SCRAPER_REGISTRY_AMEX_TO_ISRACARD, {
  type ScraperFactory,
} from './ScraperRegistryAmexToIsracard.js';
import SCRAPER_REGISTRY_LEUMI_TO_YAHAV from './ScraperRegistryLeumiToYahav.js';

/** Combined registry of all supported bank scrapers. */
const SCRAPER_REGISTRY: Partial<Record<CompanyTypes, ScraperFactory>> = {
  ...SCRAPER_REGISTRY_AMEX_TO_ISRACARD,
  ...SCRAPER_REGISTRY_LEUMI_TO_YAHAV,
};

/**
 * Create a scraper instance for the given company.
 * @param options - Scraper configuration including company ID and credentials.
 * @returns A scraper instance ready to scrape transactions.
 */
export default function createScraper(options: ScraperOptions): IScraper<ScraperCredentials> {
  const factory = SCRAPER_REGISTRY[options.companyId];
  if (factory) return factory(options);
  throw new ScraperError(`unknown company id ${options.companyId}`);
}
