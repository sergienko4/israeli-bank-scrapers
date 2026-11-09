export { CompanyTypes, SCRAPERS } from './Definitions.js';
export type {
  IScraper,
  IScraperScrapingResult,
  Scraper,
  ScraperCredentials,
  ScraperOptions,
  ScraperScrapingResult,
} from './Scrapers/Base/Interface.js';
export { default as createScraper } from './Scrapers/Registry/Factory.js';
export type {
  IWindowCoverage,
  IWindowCovered,
  IWindowLowerBoundReached,
  IWindowUnproven,
  WindowCaveat,
  WindowUnprovenReason,
} from './WindowCoverage.js';
