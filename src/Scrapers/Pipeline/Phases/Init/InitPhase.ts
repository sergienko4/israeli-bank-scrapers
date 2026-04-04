/**
 * INIT phase — PRE/ACTION/POST/FINAL per pipeline protocol.
 * PRE:    launch browser + create page (get DNS)
 * ACTION: goto bank URL (navigate to page)
 * POST:   validate page loaded correctly
 * FINAL:  wire mediator + fetchStrategy → signal to HOME
 */

import type { Browser } from 'playwright-core';

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import createElementMediator from '../../Mediator/Elements/CreateElementMediator.js';
import { createBrowserFetchStrategy } from '../../Strategy/Fetch/BrowserFetchStrategy.js';
import { BasePhase } from '../../Types/BasePhase.js';
import { toErrorMessage } from '../../Types/ErrorUtils.js';
import { some } from '../../Types/Option.js';
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

/** Whether the page loaded with a valid status. */
type PageValid = boolean;

/**
 * Wire fetchStrategy + mediator into context (FINAL helper).
 * @param input - Pipeline context with browser.
 * @returns Updated context or failure.
 */
function wireStrategyAndMediator(input: IPipelineContext): Procedure<IPipelineContext> {
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'INIT FINAL: no browser');
  const page = input.browser.value.page;
  const fetchStrategy = createBrowserFetchStrategy(page);
  const mediator = createElementMediator(page);
  const loginUrl = page.url();
  const diag = { ...input.diagnostics, loginUrl };
  return succeed({
    ...input,
    fetchStrategy: some(fetchStrategy),
    mediator: some(mediator),
    diagnostics: diag,
  });
}

/**
 * Launch browser, create page, wire into context.
 * @param input - Pipeline context with options.
 * @returns Updated context with browser state.
 */
async function launchAndWire(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  let browser: Browser | false = false;
  try {
    browser = await launchBrowser(input.options);
    const launched = await createContextAndPage(browser);
    await setupPage(launched.page, input.options);
    const state = buildBrowserState(launched.page, launched.context, browser);
    return succeed({ ...input, browser: some(state) });
  } catch (error) {
    await closeBrowserSafe(browser);
    const msg = toErrorMessage(error as Error);
    return fail(ScraperErrorTypes.Generic, `INIT PRE: browser launch failed — ${msg}`);
  }
}

/**
 * Navigate to the bank's base URL.
 * @param input - Pipeline context with browser + config.
 * @returns Same context after navigation, or failure.
 */
async function navigateToBank(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'INIT ACTION: no browser');
  const page = input.browser.value.page;
  const targetUrl = input.config.urls.base;
  process.stderr.write(`    [INIT.ACTION] navigating to ${targetUrl}\n`);
  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    const landedUrl = page.url();
    process.stderr.write(`    [INIT.ACTION] landed on ${landedUrl}\n`);
    return succeed(input);
  } catch (error) {
    const msg = toErrorMessage(error as Error);
    return fail(ScraperErrorTypes.Generic, `INIT ACTION: navigation failed — ${msg}`);
  }
}

/** INIT phase — BasePhase with PRE/ACTION/POST/FINAL. */
class InitPhase extends BasePhase {
  public readonly name = 'init' as const;

  /**
   * PRE: launch browser + create page (get DNS).
   * @param _ctx - Unused.
   * @param input - Pipeline context with options.
   * @returns Updated context with browser state.
   */
  public async pre(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    return launchAndWire(input);
  }

  /**
   * ACTION: goto bank URL (navigate to page).
   * @param _ctx - Unused.
   * @param input - Pipeline context with browser.
   * @returns Same context after navigation.
   */
  public async action(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    return navigateToBank(input);
  }

  /**
   * POST: validate page loaded correctly.
   * @param _ctx - Unused.
   * @param input - Pipeline context with browser.
   * @returns Succeed if page valid, fail if blank/error.
   */
  public async post(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'INIT POST: no browser');
    const page = input.browser.value.page;
    const currentUrl = page.url();
    const title = await page.title().catch((): string => '');
    const isValid: PageValid = currentUrl !== 'about:blank';
    process.stderr.write(`    [INIT.POST] url=${currentUrl} title="${title}"\n`);
    if (!isValid) return fail(ScraperErrorTypes.Generic, 'INIT POST: page is blank');
    return succeed(input);
  }

  /**
   * FINAL: wire mediator + fetchStrategy → signal to HOME.
   * @param _ctx - Unused.
   * @param input - Pipeline context with browser.
   * @returns Updated context with mediator + fetchStrategy.
   */
  public final(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    const wired = wireStrategyAndMediator(input);
    return Promise.resolve(wired);
  }
}

export { InitPhase };
export { createInitPhase, INIT_STEP } from './InitPhaseFactory.js';
