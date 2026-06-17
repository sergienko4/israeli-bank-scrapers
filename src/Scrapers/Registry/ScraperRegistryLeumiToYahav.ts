import { CompanyTypes } from '../../Definitions.js';
import { type IScraper, type ScraperCredentials, type ScraperOptions } from '../Base/Interface.js';
import MizrahiScraper from '../Mizrahi/MizrahiScraper.js';
import YahavScraper from '../Yahav/YahavScraper.js';

type ScraperFactory = (options: ScraperOptions) => IScraper<ScraperCredentials>;

/**
 * Scraper registry for banks Mizrahi through Yahav (alphabetical second half).
 * Split to stay within the max-dependencies limit. Leumi is pipeline-only.
 */
const SCRAPER_REGISTRY_LEUMI_TO_YAHAV: Partial<Record<CompanyTypes, ScraperFactory>> = {
  /**
   * Create a Mizrahi scraper.
   * @param options - Scraper configuration options.
   * @returns Mizrahi scraper instance.
   */
  [CompanyTypes.Mizrahi]: options => new MizrahiScraper(options),
  /**
   * Create a Yahav scraper.
   * @param options - Scraper configuration options.
   * @returns Yahav scraper instance.
   */
  [CompanyTypes.Yahav]: options => new YahavScraper(options),
};

export default SCRAPER_REGISTRY_LEUMI_TO_YAHAV;
