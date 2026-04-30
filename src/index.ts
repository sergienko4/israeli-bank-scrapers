export { CompanyTypes, SCRAPERS } from './Definitions.js';
export type {
  IScraper,
  IScraperLoginResult,
  IScraperScrapingResult,
  IScraperLoginResult as ScaperLoginResult,
  IScraperScrapingResult as ScaperScrapingResult,
  Scraper,
  ScraperCredentials,
  ScraperLoginResult,
  ScraperOptions,
  ScraperScrapingResult,
} from './Scrapers/Base/Interface.js';
export { default as createScraper } from './Scrapers/Registry/Factory.js';
