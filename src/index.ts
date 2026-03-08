export { CompanyTypes, SCRAPERS } from './Definitions.js';
export { default as createScraper } from './Scrapers/Registry/Factory.js';

// Note: the typo ScaperScrapingResult & ScraperLoginResult (sic) are exported here for backward compatibility
export type {
  ScraperLoginResult as ScaperLoginResult,
  ScraperScrapingResult as ScaperScrapingResult,
  Scraper,
  ScraperCredentials,
  ScraperLoginResult,
  ScraperOptions,
  ScraperScrapingResult,
} from './Scrapers/Base/Interface.js';
export { default as OneZeroScraper } from './Scrapers/OneZero/OneZeroScraper.js';
