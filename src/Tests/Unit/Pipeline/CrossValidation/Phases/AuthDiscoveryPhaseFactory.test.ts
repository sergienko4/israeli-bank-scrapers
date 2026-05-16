/**
 * Phase H+ - cross-bank AUTH-DISCOVERY per-phase factory (DEEP).
 *
 * <p>Honors the locked plan factory-depth expectation: drives the
 * full PRE -> ACTION -> POST -> FINAL chain per bank through real
 * production code paths.
 *
 * <ul>
 *   <li>PRE: {@link executeAuthDiscoveryPre} - settle wait +
 *     network inventory; passthrough success.</li>
 *   <li>ACTION: {@link executeAuthDiscoveryAction} - sealed
 *     pass-through (no mediator on action context).</li>
 *   <li>POST: {@link executeAuthDiscoveryPost} - cookie audit +
 *     channel collection + dashboard reveal probe + commits
 *     ctx.authDiscovery.</li>
 *   <li>FINAL: {@link executeAuthDiscoveryFinal} - dashboard gate
 *     (dashboardReady + URL check) + telemetry.</li>
 * </ul>
 *
 * <p>Per `coding-principle-guidlines.md` "Maximum 10 lines per
 * method" the `it.each` callback orchestrates via helpers.
 */

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import {
  executeAuthDiscoveryAction,
  executeAuthDiscoveryFinal,
  executeAuthDiscoveryPost,
  executeAuthDiscoveryPre,
} from '../../../../../Scrapers/Pipeline/Mediator/AuthDiscovery/AuthDiscoveryActions.js';
import type {
  IActionContext,
  IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { toActionCtx } from '../../Infrastructure/TestHelpers.js';
import { BANK_SCENARIOS, type IBankScenario } from './Fixtures/_BankScenarios.js';
import {
  buildDeepLoginContext,
  type IDeepLoginTestSubject,
} from './Fixtures/_makeDeepLoginPhaseContext.js';
import { loadAuthDiscoveryFixtureCookies } from './Fixtures/_makeLoginPhaseContext.js';

/** Bundle returned by {@link prepareAuthRow}. */
interface IAuthRowSetup {
  readonly row: IBankScenario;
  readonly subject: IDeepLoginTestSubject;
}

/**
 * Build the deep AUTH-DISCOVERY test subject. Reuses
 * {@link buildDeepLoginContext} since AUTH-DISCOVERY shares the
 * mediator surfaces with LOGIN (resolveVisible, getCookies,
 * getCurrentUrl, network.*).
 *
 * @param row - Per-bank scenario row.
 * @returns Row + deep test subject.
 */
function prepareAuthRow(row: IBankScenario): IAuthRowSetup {
  const cookies = loadAuthDiscoveryFixtureCookies(row.bank, 'last-good');
  const placeholderConfig = { fields: [], submit: [], loginUrl: '' } as unknown as Parameters<
    typeof buildDeepLoginContext
  >[0]['loginConfig'];
  const subject = buildDeepLoginContext({
    loginConfig: placeholderConfig,
    loginUrl: row.dashboardUrl,
    cookies,
  });
  return { row, subject };
}

/**
 * Drive AUTH-DISCOVERY.PRE via production executeAuthDiscoveryPre.
 *
 * @param setup - Row + deep test subject.
 * @returns PRE-updated pipeline context.
 */
async function runAuthPre(setup: IAuthRowSetup): Promise<IPipelineContext> {
  const result = await executeAuthDiscoveryPre(setup.subject.context);
  if (!result.success) {
    throw new ScraperError(`AUTH_PRE_FAILED bank=${setup.row.bank} - ${result.errorMessage}`);
  }
  return result.value;
}

/**
 * Drive AUTH-DISCOVERY.ACTION (sealed pass-through).
 *
 * @param setup - Row + deep test subject.
 * @param preCtx - PRE-updated context.
 * @returns Action-context pass-through.
 */
async function runAuthAction(
  setup: IAuthRowSetup,
  preCtx: IPipelineContext,
): Promise<IActionContext> {
  const actionCtx = toActionCtx(preCtx, setup.subject.executor);
  const result = await executeAuthDiscoveryAction(actionCtx);
  if (!result.success) {
    throw new ScraperError(`AUTH_ACTION_FAILED bank=${setup.row.bank} - ${result.errorMessage}`);
  }
  return result.value;
}

/**
 * Drive AUTH-DISCOVERY.POST via production executeAuthDiscoveryPost.
 *
 * @param setup - Row + deep test subject.
 * @param preCtx - PRE-updated context.
 * @returns POST-updated pipeline context.
 */
async function runAuthPost(
  setup: IAuthRowSetup,
  preCtx: IPipelineContext,
): Promise<IPipelineContext> {
  const result = await executeAuthDiscoveryPost(preCtx);
  if (!result.success) {
    throw new ScraperError(`AUTH_POST_FAILED bank=${setup.row.bank} - ${result.errorMessage}`);
  }
  return result.value;
}

/**
 * Drive AUTH-DISCOVERY.FINAL via production executeAuthDiscoveryFinal.
 *
 * @param setup - Row + deep test subject.
 * @param postCtx - POST-updated context.
 * @returns FINAL-updated pipeline context.
 */
async function runAuthFinal(
  setup: IAuthRowSetup,
  postCtx: IPipelineContext,
): Promise<IPipelineContext> {
  const result = await executeAuthDiscoveryFinal(postCtx);
  if (!result.success) {
    throw new ScraperError(`AUTH_FINAL_FAILED bank=${setup.row.bank} - ${result.errorMessage}`);
  }
  return result.value;
}

/**
 * Run the full AUTH-DISCOVERY PRE -> ACTION -> POST -> FINAL chain.
 *
 * @param setup - Row + deep test subject.
 * @returns FINAL pipeline context.
 */
async function runAuthChain(setup: IAuthRowSetup): Promise<IPipelineContext> {
  const preCtx = await runAuthPre(setup);
  await runAuthAction(setup, preCtx);
  const postCtx = await runAuthPost(setup, preCtx);
  return runAuthFinal(setup, postCtx);
}

/**
 * Assert authDiscovery was committed by POST.
 *
 * @param finalCtx - Context after the chain.
 * @returns True after assertion.
 */
function assertAuthFinalShape(finalCtx: IPipelineContext): boolean {
  expect(finalCtx.authDiscovery.has).toBe(true);
  return true;
}

describe('AUTH-DISCOVERY-PHASE-FACTORY - DEEP cross-bank PRE-ACTION-POST-FINAL', () => {
  it.each(BANK_SCENARIOS)(
    'authDiscovery_$bank_ShouldCompleteFullChain',
    async (row): Promise<void> => {
      const setup = prepareAuthRow(row);
      const finalCtx = await runAuthChain(setup);
      assertAuthFinalShape(finalCtx);
    },
  );
});
