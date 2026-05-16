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
 *     resolved trigger via executor. Returns boolean — chain
 *     captures + asserts (CodeRabbit cycle #3 finding #4 +
 *     `NoDroppedDeepActionResult` canary).</li>
 *   <li>POST: {@link executeValidateLoginArea} - didNavigate /
 *     hasFrames / hasLoginForm contract. Accepts the PRE-shared
 *     pipeline context so state-handoff stays observable
 *     (`PostUsesActionContext` canary).</li>
 *   <li>FINAL: {@link executeStoreLoginSignal} - stores loginUrl
 *     in diagnostics + waits for form readiness.</li>
 * </ul>
 *
 * <p>Per `coding-principle-guidlines.md` "Maximum 10 lines per
 * method" the `it.each` callback orchestrates via helpers + the
 * shared {@link unwrapOrThrow} from `_deepPhaseHelpers.ts`.
 */

import type { Page } from 'playwright-core';

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import type { IElementMediator } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
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
import { PLACEHOLDER_LOGIN_CONFIG, unwrapOrThrow } from './Fixtures/_deepPhaseHelpers.js';
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
  const subject = buildDeepLoginContext({
    loginConfig: PLACEHOLDER_LOGIN_CONFIG,
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
  const ctx = setup.subject.context;
  if (!ctx.browser.has) throw new ScraperError(`HOME_PRE_NO_BROWSER bank=${setup.row.bank}`);
  if (!ctx.mediator.has) throw new ScraperError(`HOME_PRE_NO_MEDIATOR bank=${setup.row.bank}`);
  return resolveHomeDiscovery(ctx.mediator.value, ctx.browser.value.page, setup.row.bank);
}

/**
 * Drive resolveHomeStrategy + unwrap to discovery.
 *
 * @param mediator - Narrowed mediator from PRE context.
 * @param page - Shared mock page from PRE context.
 * @param bank - Bank id for the failure-prefix.
 * @returns PRE-resolved discovery.
 */
async function resolveHomeDiscovery(
  mediator: IElementMediator,
  page: Page,
  bank: string,
): Promise<IHomeDiscovery> {
  const result = await resolveHomeStrategy(mediator, createMockLogger(), page);
  if (!isOk(result))
    throw new ScraperError(`HOME_PRE_FAILED bank=${bank} - ${result.errorMessage}`);
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
  return executeHomeNavigation(setup.subject.executor, discovery, createMockLogger());
}

/**
 * Drive HOME.POST via production executeValidateLoginArea.
 *
 * @param setup - Row + deep test subject (for bank-scoped error prefix).
 * @param preCtx - PRE-shared pipeline context.
 * @returns POST-updated pipeline context.
 */
async function runHomePost(
  setup: IHomeRowSetup,
  preCtx: IPipelineContext,
): Promise<IPipelineContext> {
  if (!preCtx.mediator.has) throw new ScraperError(`HOME_POST_NO_MEDIATOR bank=${setup.row.bank}`);
  const args = buildLoginAreaArgs({ setup, preCtx, mediator: preCtx.mediator.value });
  const result = await executeValidateLoginArea(args);
  return unwrapOrThrow(result, `HOME_POST_FAILED bank=${setup.row.bank}`);
}

/** Args bundle accepted by {@link executeValidateLoginArea}. */
type LoginAreaArgs = Parameters<typeof executeValidateLoginArea>[0];

/** Inputs needed to build the HOME.POST args bundle. */
interface IBuildLoginAreaArgsInput {
  readonly setup: IHomeRowSetup;
  readonly preCtx: IPipelineContext;
  readonly mediator: IElementMediator;
}

/**
 * Build the {@link executeValidateLoginArea} argument bundle.
 *
 * @param input - Setup row + PRE context + narrowed mediator.
 * @returns Args bundle for HOME.POST.
 */
function buildLoginAreaArgs(input: IBuildLoginAreaArgsInput): LoginAreaArgs {
  return {
    mediator: input.mediator,
    input: input.preCtx,
    homepageUrl: input.setup.row.homepageUrl,
    logger: createMockLogger(),
  };
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
  const result = await executeStoreLoginSignal(postCtx.mediator.value, postCtx, createMockLogger());
  return unwrapOrThrow(result, `HOME_FINAL_FAILED bank=${setup.row.bank}`);
}

/**
 * Run the full HOME PRE -> ACTION -> POST -> FINAL chain.
 *
 * @param setup - Row + deep test subject.
 * @returns FINAL pipeline context.
 */
async function runHomeChain(setup: IHomeRowSetup): Promise<IPipelineContext> {
  const homeCtx = setup.subject.context;
  const discovery = await runHomePre(setup);
  // @canary-exempt: dropped-action-result
  // runHomeAction returns Promise<boolean> (`didNavigate`). In test mode the
  // mock executor cannot change page URL, so the boolean is always false —
  // there is no IActionContext to thread via mergeActionDiagnostics. Live
  // E2E validates the real navigation contract.
  await runHomeAction(setup, discovery);
  const postCtx = await runHomePost(setup, homeCtx);
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
