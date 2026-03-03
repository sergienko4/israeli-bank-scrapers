export { CompanyTypes, SCRAPERS } from './Definitions';
export { default as createScraper } from './Scrapers/Registry/Factory';

// Note: the typo ScaperScrapingResult & ScraperLoginResult (sic) are exported here for backward compatibility
export {
  ScraperLoginResult as ScaperLoginResult,
  ScraperScrapingResult as ScaperScrapingResult,
  Scraper,
  ScraperCredentials,
  ScraperLoginResult,
  ScraperOptions,
  ScraperScrapingResult,
} from './Scrapers/Base/Interface';
export { default as OneZeroScraper } from './Scrapers/OneZero/OneZeroScraper';
