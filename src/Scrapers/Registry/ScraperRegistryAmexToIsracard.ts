import { CompanyTypes } from '../../Definitions.js';
import { type IScraper, type ScraperCredentials, type ScraperOptions } from '../Base/Interface.js';
import BehatsdaaScraper from '../Behatsdaa/BehatsdaaScraper.js';
import BeinleumiScraper from '../Beinleumi/BeinleumiScraper.js';
import BeyahadBishvilhaScraper from '../BeyahadBishvilha/BeyahadBishvilhaScraper.js';
import HapoalimScraper from '../Hapoalim/HapoalimScraper.js';

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
   * Create a Beinleumi scraper.
   * @param options - Scraper configuration options.
   * @returns Beinleumi scraper instance.
   */
  [CompanyTypes.Beinleumi]: options => new BeinleumiScraper(options),
  /**
   * Create a BeyahadBishvilha scraper.
   * @param options - Scraper configuration options.
   * @returns BeyahadBishvilha scraper instance.
   */
  [CompanyTypes.BeyahadBishvilha]: options => new BeyahadBishvilhaScraper(options),
  /**
   * Create a Hapoalim scraper.
   * @param options - Scraper configuration options.
   * @returns Hapoalim scraper instance.
   */
  [CompanyTypes.Hapoalim]: options => new HapoalimScraper(options),
};

export default SCRAPER_REGISTRY_AMEX_TO_ISRACARD;
