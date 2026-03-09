export { CompanyTypes, SCRAPERS } from './Definitions.js';
export type {
  IScraper,
  IScraperLoginResult,
  IScraperScrapingResult,
  IScraperLoginResult as ScaperLoginResult,
  IScraperScrapingResult as ScaperScrapingResult,
  ScraperCredentials,
  ScraperOptions,
} from './Scrapers/Base/Interface.js';
export { default as OneZeroScraper } from './Scrapers/OneZero/OneZeroScraper.js';
export { default as createScraper } from './Scrapers/Registry/Factory.js';
