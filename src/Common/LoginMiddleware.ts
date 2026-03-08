import type { Frame, Page } from 'playwright';

import type { ScraperScrapingResult } from '../Scrapers/Base/Interface.js';
import type { BankScraperConfig } from '../Scrapers/Registry/ScraperConfig.js';

/** Context passed through the middleware chain. */
export interface LoginContext {
  page: Page;
  activeFrame: Page | Frame;
  loginSetup: BankScraperConfig['loginSetup'];
}

/** Result from a middleware step. */
export interface StepResult {
  /** true = continue to next step, false = stop chain and return `result`. */
  shouldContinue: boolean;
  /** Only set when shouldContinue is false — the final scraping result. */
  result?: ScraperScrapingResult;
}

/** A single step in the login chain. */
export type LoginStep = (ctx: LoginContext) => Promise<StepResult>;

const CONTINUE: StepResult = { shouldContinue: true };

export function stopWithResult(result: ScraperScrapingResult): StepResult {
  return { shouldContinue: false, result };
}

/** Run a chain of login steps. Stops at the first step that returns shouldContinue=false. */
export async function runLoginChain(
  steps: LoginStep[],
  ctx: LoginContext,
): Promise<ScraperScrapingResult | null> {
  for (const step of steps) {
    const result = await step(ctx);
    if (!result.shouldContinue) return result.result ?? null;
  }
  return null;
}

export { CONTINUE };
