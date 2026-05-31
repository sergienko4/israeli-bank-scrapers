import type { Frame, Page } from 'playwright-core';

import type { IScraperScrapingResult } from '../Scrapers/Base/Interface.js';
import type { IBankScraperConfig } from '../Scrapers/Registry/Config/ScraperConfig.js';

/** Cached result of the HTML structure parse — populated once by stepParseLoginPage. */
export interface IParsedLoginPage {
  /** All accessible child frames (excludes mainFrame, cross-origin failures). */
  childFrames: Frame[];
  /** The frame (or main page) where the first login input was found — null if not yet detected. */
  loginFormContext: Page | Frame | null;
  /** Main page URL at time of parse. */
  pageUrl: string;
  /** Page body text (for OTP text detection). */
  bodyText: string;
}

/** Context passed through the middleware chain. */
export interface ILoginContext {
  page: Page;
  activeFrame: Page | Frame;
  loginSetup: IBankScraperConfig['loginSetup'];
  /** Cached page structure — set by stepParseLoginPage, consumed by downstream steps. */
  parsedPage?: IParsedLoginPage;
}

/** Result from a middleware step. */
export interface IStepResult {
  /** true = continue to next step, false = stop chain and return `result`. */
  shouldContinue: boolean;
  /** Only set when shouldContinue is false — the final scraping result. */
  result?: IScraperScrapingResult;
}

/** A single step in the login chain. */
export type LoginStep = (ctx: ILoginContext) => Promise<IStepResult>;

/** A login step with a human-readable name for logging. */
export interface INamedLoginStep {
  /** Short name for logs, e.g. 'navigate', 'fill', 'otp-confirm'. */
  readonly name: string;
  /** The step function to execute. */
  readonly execute: LoginStep;
}

const CONTINUE: IStepResult = { shouldContinue: true };

/**
 * Create a stop result that terminates the login chain with a scraping result.
 * @param result - The scraping result to return from the chain.
 * @returns A step result with shouldContinue=false.
 */
export function stopWithResult(result: IScraperScrapingResult): IStepResult {
  return { shouldContinue: false, result };
}

/** Nullable scraping result — matches upstream chain return semantics. */
type NullableChainResult = Promise<IScraperScrapingResult | null>;

/**
 * Run a chain of login steps. Stops at the first step that returns shouldContinue=false.
 * @param steps - The ordered login step functions.
 * @param ctx - The login context shared across steps.
 * @returns The scraping result from the first stopping step, or null if all continued.
 */
export async function runLoginChain(steps: LoginStep[], ctx: ILoginContext): NullableChainResult {
  const actions = steps.map(
    (step): (() => Promise<IStepResult>) =>
      () =>
        step(ctx),
  );
  const initialValue: Promise<IStepResult> = Promise.resolve(CONTINUE);
  const finalResult = await actions.reduce<Promise<IStepResult>>(async (prev, action) => {
    const prevResult = await prev;
    if (!prevResult.shouldContinue) return prevResult;
    return action();
  }, initialValue);
  return finalResult.result ?? null;
}

export { CONTINUE };
