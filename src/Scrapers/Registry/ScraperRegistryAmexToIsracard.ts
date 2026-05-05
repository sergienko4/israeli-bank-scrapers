import { CompanyTypes } from '../../Definitions.js';
import { type IScraper, type ScraperCredentials, type ScraperOptions } from '../Base/Interface.js';
import BehatsdaaScraper from '../Behatsdaa/BehatsdaaScraper.js';
import BeyahadBishvilhaScraper from '../BeyahadBishvilha/BeyahadBishvilhaScraper.js';

/** IScraper factory function type. */
export type ScraperFactory = (options: ScraperOptions) => IScraper<ScraperCredentials>;

/**
 * Scraper registry for banks Amex through Isracard (alphabetical first half).
 * Split to stay within the max-dependencies limit.
 */
const SCRAPER_REGISTRY_AMEX_TO_ISRACARD: Partial<Record<CompanyTypes, ScraperFactory>> = {
  /**
   * Create a Behatsdaa scraper.
   * @param options - Scraper configuration options.
   * @returns Behatsdaa scraper instance.
   */
  [CompanyTypes.Behatsdaa]: options => new BehatsdaaScraper(options),
  /**
   * Create a BeyahadBishvilha scraper.
   * @param options - Scraper configuration options.
   * @returns BeyahadBishvilha scraper instance.
   */
  [CompanyTypes.BeyahadBishvilha]: options => new BeyahadBishvilhaScraper(options),
};

export default SCRAPER_REGISTRY_AMEX_TO_ISRACARD;
