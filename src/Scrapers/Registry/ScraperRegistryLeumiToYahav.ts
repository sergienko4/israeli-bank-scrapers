import { CompanyTypes } from '../../Definitions.js';
import { type IScraper, type ScraperCredentials, type ScraperOptions } from '../Base/Interface.js';
import MizrahiScraper from '../Mizrahi/MizrahiScraper.js';

type ScraperFactory = (options: ScraperOptions) => IScraper<ScraperCredentials>;

/**
 * Scraper registry for banks Mizrahi through Yahav (alphabetical second half).
 * Split to stay within the max-dependencies limit. Leumi and Yahav are
 * pipeline-only.
 */
const SCRAPER_REGISTRY_LEUMI_TO_YAHAV: Partial<Record<CompanyTypes, ScraperFactory>> = {
  /**
   * Create a Mizrahi scraper.
   * @param options - Scraper configuration options.
   * @returns Mizrahi scraper instance.
   */
  [CompanyTypes.Mizrahi]: options => new MizrahiScraper(options),
};

export default SCRAPER_REGISTRY_LEUMI_TO_YAHAV;
