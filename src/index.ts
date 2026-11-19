export { CompanyTypes, ScraperProgressTypes, SCRAPERS } from './Definitions.js';
export { ScraperErrorTypes } from './Scrapers/Base/ErrorTypes.js';
export type {
  IAuthFlowInfo,
  IScraper,
  IScraperScrapingResult,
  IWafErrorDetails,
  Scraper,
  ScraperCredentials,
  ScraperOptions,
  ScraperScrapingResult,
} from './Scrapers/Base/Interface.js';
export { default as createScraper } from './Scrapers/Registry/Factory.js';
export type { ITransaction } from './Transactions.js';
export { TransactionStatuses, TransactionTypes } from './Transactions.js';
export type {
  IWindowCoverage,
  IWindowCovered,
  IWindowLowerBoundReached,
  IWindowUnproven,
  WindowCaveat,
  WindowUnprovenReason,
} from './WindowCoverage.js';
