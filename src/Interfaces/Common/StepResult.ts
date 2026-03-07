/** IScraper lifecycle state machine states — used by IScraperStepResult.nextState. */
export type ScraperState =
  | 'INITIALIZING'
  | 'LOGGING_IN'
  | 'EXTRACTING_DATA'
  | 'COMPLETED'
  | 'FAILED';

/**
 * Generic step result for scraper state transitions.
 * Use as return type for scraper step functions instead of returning null or undefined.
 * nextState signals whether the caller should continue ('LOGGING_IN') or stop ('COMPLETED'/'FAILED').
 */
export interface IScraperStepResult<TData = never> {
  nextState: ScraperState;
  data?: TData;
  error?: string;
  screenshotPath?: string;
}

/**
 * Minimal result for side-effect functions — replaces Promise<void>.
 * Every function must return a meaningful value per the Result Pattern.
 */
export interface IDoneResult {
  done: true;
}
