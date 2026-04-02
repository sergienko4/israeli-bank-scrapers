import { CompanyTypes } from '../../Definitions.js';
import { type IScraper, type ScraperCredentials, type ScraperOptions } from '../Base/Interface.js';
import BehatsdaaScraper from '../Behatsdaa/BehatsdaaScraper.js';
import BeinleumiScraper from '../Beinleumi/BeinleumiScraper.js';
import BeyahadBishvilhaScraper from '../BeyahadBishvilha/BeyahadBishvilhaScraper.js';
import HapoalimScraper from '../Hapoalim/HapoalimScraper.js';
import IsracardScraper from '../Isracard/IsracardScraper.js';

/** IScraper factory function type. */
export type ScraperFactory = (options: ScraperOptions) => IScraper<ScraperCredentials>;

/**
 * Scraper registry for banks Amex through Isracard (alphabetical first half).
 * Split to stay within the max-dependencies limit.
 */
const SCRAPER_REGISTRY_AMEX_TO_ISRACARD: Partial<Record<CompanyTypes, ScraperFactory>> = {
  // Amex — handled by Pipeline (PIPELINE_REGISTRY)
  // [CompanyTypes.Amex]: options => new AmexScraper(options),
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
  // Discount — handled by Pipeline (PIPELINE_REGISTRY)
  // [CompanyTypes.Discount]: options => new DiscountScraper(options),
  /**
   * Create a Hapoalim scraper.
   * @param options - Scraper configuration options.
   * @returns Hapoalim scraper instance.
   */
  [CompanyTypes.Hapoalim]: options => new HapoalimScraper(options),
  /**
   * Create an Isracard scraper.
   * @param options - Scraper configuration options.
   * @returns Isracard scraper instance.
   */
  [CompanyTypes.Isracard]: options => new IsracardScraper(options),
};

export default SCRAPER_REGISTRY_AMEX_TO_ISRACARD;
