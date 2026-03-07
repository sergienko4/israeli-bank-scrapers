export {
  BrowserEngineType,
  getGlobalEngineChain,
  setGlobalDefaultEngine,
  setGlobalEngineChain,
} from './Common/BrowserEngine';
export { CompanyTypes, SCRAPERS } from './Definitions';
export {
  DEFAULT_ENGINE_CHAIN,
  type IScraperEngineAttempt,
  ScraperWithFallback,
} from './Scrapers/Base/ScraperWithFallback';
export { default as createScraper, createScraperWithFallback } from './Scrapers/Registry/Factory';

// Note: the typo ScaperScrapingResult & IScraperLoginResult (sic) are exported here for backward compatibility
export {
  IScraper,
  IScraperLoginResult,
  IScraperScrapingResult,
  IScraperLoginResult as ScaperLoginResult,
  IScraperScrapingResult as ScaperScrapingResult,
  ScraperCredentials,
  ScraperOptions,
} from './Scrapers/Base/Interface';
export { default as OneZeroScraper } from './Scrapers/OneZero/OneZeroScraper';
