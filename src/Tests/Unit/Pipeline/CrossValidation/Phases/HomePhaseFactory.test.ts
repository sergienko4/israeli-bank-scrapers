/**
 * Phase H+ - cross-bank HOME per-phase factory (DEEP).
 *
 * <p>Honors the locked plan factory-depth expectation: drives the
 * full PRE -> ACTION -> POST -> FINAL chain per bank through real
 * production code paths.
 *
 * <ul>
 *   <li>PRE: {@link resolveHomeStrategy} - passive login-trigger
 *     discovery via mediator.resolveVisible(WK_HOME.ENTRY).</li>
 *   <li>ACTION: {@link executeHomeNavigation} - sealed click on the
 *     resolved trigger via executor.</li>
 *   <li>POST: {@link executeValidateLoginArea} - didNavigate /
 *     hasFrames / hasLoginForm contract.</li>
 *   <li>FINAL: {@link executeStoreLoginSignal} - stores loginUrl
 *     in diagnostics + waits for form readiness.</li>
 * </ul>
 *
 * <p>Per `coding-principle-guidlines.md` "Maximum 10 lines per
 * method" the `it.each` callback orchestrates via helpers
 * (`prepareHomeRow`, `runHomeChain`, `assertHomeFinalShape`).
 */

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import {
  executeHomeNavigation,
  executeStoreLoginSignal,
  executeValidateLoginArea,
} from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeActions.js';
import type { IHomeDiscovery } from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeResolver.js';
import { resolveHomeStrategy } from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeResolver.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { createMockLogger } from '../../Infrastructure/MockFactories.js';
import { BANK_SCENARIOS, type IBankScenario } from './Fixtures/_BankScenarios.js';
import {
  buildDeepLoginContext,
  type IDeepLoginTestSubject,
} from './Fixtures/_makeDeepLoginPhaseContext.js';
import { loadAuthDiscoveryFixtureCookies } from './Fixtures/_makeLoginPhaseContext.js';

/** Bundle returned by {@link prepareHomeRow} for one scenario. */
interface IHomeRowSetup {
  readonly row: IBankScenario;
  readonly subject: IDeepLoginTestSubject;
}

/**
 * Build the deep HOME test subject. Reuses
 * {@link buildDeepLoginContext} for the mediator+executor wiring
 * since HOME shares the same surfaces (resolveVisible, executor
 * clickElement). LoginConfig field is a no-op placeholder for HOME.
 *
 * @param row - Per-bank scenario row.
 * @returns Row + deep test subject.
 */
function prepareHomeRow(row: IBankScenario): IHomeRowSetup {
  const cookies = loadAuthDiscoveryFixtureCookies(row.bank, 'last-good');
  const placeholderConfig = { fields: [], submit: [], loginUrl: '' } as unknown as Parameters<
    typeof buildDeepLoginContext
  >[0]['loginConfig'];
  const subject = buildDeepLoginContext({
    loginConfig: placeholderConfig,
    loginUrl: row.postNavUrl,
    cookies,
  });
  return { row, subject };
}

/**
 * Drive HOME.PRE via production resolveHomeStrategy.
 *
 * @param setup - Row + deep test subject.
 * @returns Discovery from PRE.
 */
async function runHomePre(setup: IHomeRowSetup): Promise<IHomeDiscovery> {
  if (!setup.subject.context.browser.has) {
    throw new ScraperError(`HOME_PRE_NO_BROWSER bank=${setup.row.bank}`);
  }
  if (!setup.subject.context.mediator.has) {
    throw new ScraperError(`HOME_PRE_NO_MEDIATOR bank=${setup.row.bank}`);
  }
  const logger = createMockLogger();
  const result = await resolveHomeStrategy(
    setup.subject.context.mediator.value,
    logger,
    setup.subject.context.browser.value.page,
  );
  if (!isOk(result)) {
    throw new ScraperError(`HOME_PRE_FAILED bank=${setup.row.bank} - ${result.errorMessage}`);
  }
  return result.value;
}

/**
 * Drive HOME.ACTION via production executeHomeNavigation.
 *
 * @param setup - Row + deep test subject.
 * @param discovery - PRE-resolved discovery.
 * @returns True when navigation observed.
 */
async function runHomeAction(setup: IHomeRowSetup, discovery: IHomeDiscovery): Promise<boolean> {
  const logger = createMockLogger();
  return executeHomeNavigation(setup.subject.executor, discovery, logger);
}

/**
 * Drive HOME.POST via production executeValidateLoginArea.
 *
 * @param setup - Row + deep test subject.
 * @returns POST-updated pipeline context.
 */
async function runHomePost(setup: IHomeRowSetup): Promise<IPipelineContext> {
  if (!setup.subject.context.mediator.has) {
    throw new ScraperError(`HOME_POST_NO_MEDIATOR bank=${setup.row.bank}`);
  }
  const result = await executeValidateLoginArea({
    mediator: setup.subject.context.mediator.value,
    input: setup.subject.context,
    homepageUrl: setup.row.homepageUrl,
    logger: createMockLogger(),
  });
  if (!result.success) {
    throw new ScraperError(`HOME_POST_FAILED bank=${setup.row.bank} - ${result.errorMessage}`);
  }
  return result.value;
}

/**
 * Drive HOME.FINAL via production executeStoreLoginSignal.
 *
 * @param setup - Row + deep test subject.
 * @param postCtx - POST-updated context.
 * @returns FINAL-updated pipeline context.
 */
async function runHomeFinal(
  setup: IHomeRowSetup,
  postCtx: IPipelineContext,
): Promise<IPipelineContext> {
  if (!postCtx.mediator.has) {
    throw new ScraperError(`HOME_FINAL_NO_MEDIATOR bank=${setup.row.bank}`);
  }
  const logger = createMockLogger();
  const result = await executeStoreLoginSignal(postCtx.mediator.value, postCtx, logger);
  if (!result.success) {
    throw new ScraperError(`HOME_FINAL_FAILED bank=${setup.row.bank} - ${result.errorMessage}`);
  }
  return result.value;
}

/**
 * Run the full HOME PRE -> ACTION -> POST -> FINAL chain.
 *
 * @param setup - Row + deep test subject.
 * @returns FINAL pipeline context.
 */
async function runHomeChain(setup: IHomeRowSetup): Promise<IPipelineContext> {
  const discovery = await runHomePre(setup);
  await runHomeAction(setup, discovery);
  const postCtx = await runHomePost(setup);
  return runHomeFinal(setup, postCtx);
}

/**
 * Assert FINAL stamped loginUrl into diagnostics.
 *
 * @param finalCtx - Context after the chain.
 * @returns True after assertion.
 */
function assertHomeFinalShape(finalCtx: IPipelineContext): boolean {
  expect(typeof finalCtx.diagnostics.loginUrl).toBe('string');
  return true;
}

describe('HOME-PHASE-FACTORY - DEEP cross-bank PRE-ACTION-POST-FINAL', () => {
  it.each(BANK_SCENARIOS)('home_$bank_ShouldCompleteFullChain', async (row): Promise<void> => {
    const setup = prepareHomeRow(row);
    const finalCtx = await runHomeChain(setup);
    assertHomeFinalShape(finalCtx);
  });
});
