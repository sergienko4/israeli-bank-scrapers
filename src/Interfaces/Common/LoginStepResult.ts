import type { IScraperScrapingResult } from '../../Scrapers/Base/Interface';

/**
 * Replaces IScraperScrapingResult | null in login flow step functions.
 * shouldContinue: true  — caller proceeds to the next step in the login sequence.
 * shouldContinue: false — caller stops and returns result immediately to the scraper.
 */
export type LoginStepResult =
  | { shouldContinue: true }
  | { shouldContinue: false; result: IScraperScrapingResult };
