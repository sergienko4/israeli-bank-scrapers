import { CompanyTypes } from '../../Definitions.js';
import { type IScraper, type ScraperCredentials, type ScraperOptions } from '../Base/Interface.js';
import LeumiScraper from '../Leumi/LeumiScraper.js';
import MassadScraper from '../Massad/MassadScraper.js';
import MaxScraper from '../Max/MaxScraper.js';
import MercantileScraper from '../Mercantile/MercantileScraper.js';
import MizrahiScraper from '../Mizrahi/MizrahiScraper.js';
import OneZeroScraper from '../OneZero/OneZeroScraper.js';
import OtsarHahayalScraper from '../OtsarHahayal/OtsarHahayalScraper.js';
import PagiScraper from '../Pagi/PagiScraper.js';
import YahavScraper from '../Yahav/YahavScraper.js';

type ScraperFactory = (options: ScraperOptions) => IScraper<ScraperCredentials>;

/**
 * Scraper registry for banks Leumi through Yahav (alphabetical second half).
 * Split to stay within the max-dependencies limit.
 */
const SCRAPER_REGISTRY_LEUMI_TO_YAHAV: Partial<Record<CompanyTypes, ScraperFactory>> = {
  /**
   * Create a Leumi scraper.
   * @param options - Scraper configuration options.
   * @returns Leumi scraper instance.
   */
  [CompanyTypes.Leumi]: options => new LeumiScraper(options),
  /**
   * Create a Massad scraper.
   * @param options - Scraper configuration options.
   * @returns Massad scraper instance.
   */
  [CompanyTypes.Massad]: options => new MassadScraper(options),
  /**
   * Create a Max scraper.
   * @param options - Scraper configuration options.
   * @returns Max scraper instance.
   */
  [CompanyTypes.Max]: options => new MaxScraper(options),
  /**
   * Create a Mercantile scraper.
   * @param options - Scraper configuration options.
   * @returns Mercantile scraper instance.
   */
  [CompanyTypes.Mercantile]: options => new MercantileScraper(options),
  /**
   * Create a Mizrahi scraper.
   * @param options - Scraper configuration options.
   * @returns Mizrahi scraper instance.
   */
  [CompanyTypes.Mizrahi]: options => new MizrahiScraper(options),
  /**
   * Create an OtsarHahayal scraper.
   * @param options - Scraper configuration options.
   * @returns OtsarHahayal scraper instance.
   */
  [CompanyTypes.OtsarHahayal]: options => new OtsarHahayalScraper(options),
  /**
   * Create a Yahav scraper.
   * @param options - Scraper configuration options.
   * @returns Yahav scraper instance.
   */
  [CompanyTypes.Yahav]: options => new YahavScraper(options),
  /**
   * Create a OneZero scraper.
   * @param options - Scraper configuration options.
   * @returns OneZero scraper instance.
   */
  [CompanyTypes.OneZero]: options => new OneZeroScraper(options),
  /**
   * Create a Pagi scraper.
   * @param options - Scraper configuration options.
   * @returns Pagi scraper instance.
   */
  [CompanyTypes.Pagi]: options => new PagiScraper(options),
};

export default SCRAPER_REGISTRY_LEUMI_TO_YAHAV;
