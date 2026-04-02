/**
 * Init phase — browser launch + page setup + strategy + mediator creation.
 * Browser setup helpers in InitBrowserSetup.ts.
 */

import type { Browser, BrowserContext, Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import createElementMediator from '../../Mediator/Elements/CreateElementMediator.js';
import { createBrowserFetchStrategy } from '../../Strategy/Fetch/BrowserFetchStrategy.js';
import { toErrorMessage } from '../../Types/ErrorUtils.js';
import { some } from '../../Types/Option.js';
import type { IPipelineStep } from '../../Types/Phase.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import {
  buildBrowserState,
  closeBrowserSafe,
  createContextAndPage,
  launchBrowser,
  setupPage,
} from './InitBrowserSetup.js';

/** Launched browser components for wiring into context. */
interface ILaunchedBrowser {
  readonly browser: Browser;
  readonly context: BrowserContext;
  readonly page: Page;
}

/**
 * Wire browser components into context after successful launch.
 * @param input - The base context to extend.
 * @param launched - The launched browser, context, and page.
 * @returns New context with browser, fetchStrategy, mediator.
 */
function wireComponents(input: IPipelineContext, launched: ILaunchedBrowser): IPipelineContext {
  const state = buildBrowserState(launched.page, launched.context, launched.browser);
  const fetchStrategy = createBrowserFetchStrategy(launched.page);
  const mediator = createElementMediator(launched.page);
  return {
    ...input,
    browser: some(state),
    fetchStrategy: some(fetchStrategy),
    mediator: some(mediator),
  };
}

/**
 * Handle init failure — close browser if launched, return failure Procedure.
 * @param caught - The caught error.
 * @param browser - Browser handle or false.
 * @param ctx - Pipeline context for logging.
 * @returns Failure Procedure.
 */
async function handleInitError(
  caught: Error,
  browser: Browser | false,
  ctx: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  await closeBrowserSafe(browser);
  const msg = toErrorMessage(caught);
  ctx.logger.debug('InitPhase failed: %s', msg);
  return fail(ScraperErrorTypes.Generic, `InitPhase failed: ${msg}`);
}

/**
 * Execute the init phase — launch browser, create page, wire strategy + mediator.
 * @param ctx - Current pipeline context.
 * @param input - Input context to extend.
 * @returns New context with browser, fetchStrategy, and mediator populated.
 */
async function executeInit(
  ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  let browser: Browser | false = false;
  try {
    browser = await launchBrowser(ctx.options);
    const launched = await createContextAndPage(browser);
    await setupPage(launched.page, ctx.options);
    const wired = wireComponents(input, { browser, ...launched });
    return succeed(wired);
  } catch (error) {
    return handleInitError(error as Error, browser, ctx);
  }
}

/** Init phase step — launches browser and creates page. */
const INIT_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'init-browser',
  execute: executeInit,
};

export default INIT_STEP;
export { INIT_STEP };
