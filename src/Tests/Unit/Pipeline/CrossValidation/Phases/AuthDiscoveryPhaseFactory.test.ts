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
 * method" the `it.each` callback orchestrates via helpers + the
 * shared {@link unwrapOrThrow} from `_deepPhaseHelpers.ts`.
 */

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
  mergeActionDiagnostics,
  PLACEHOLDER_LOGIN_CONFIG,
  unwrapOrThrow,
} from './Fixtures/_deepPhaseHelpers.js';
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
  const subject = buildDeepLoginContext({
    loginConfig: PLACEHOLDER_LOGIN_CONFIG,
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
  return unwrapOrThrow(result, `AUTH_PRE_FAILED bank=${setup.row.bank}`);
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
  return unwrapOrThrow(result, `AUTH_ACTION_FAILED bank=${setup.row.bank}`);
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
  return unwrapOrThrow(result, `AUTH_POST_FAILED bank=${setup.row.bank}`);
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
  return unwrapOrThrow(result, `AUTH_FINAL_FAILED bank=${setup.row.bank}`);
}

/**
 * Run the full AUTH-DISCOVERY PRE -> ACTION -> POST -> FINAL chain.
 *
 * @param setup - Row + deep test subject.
 * @returns FINAL pipeline context.
 */
async function runAuthChain(setup: IAuthRowSetup): Promise<IPipelineContext> {
  const preCtx = await runAuthPre(setup);
  const actionCtx = await runAuthAction(setup, preCtx);
  const postInput = mergeActionDiagnostics(preCtx, actionCtx);
  const postCtx = await runAuthPost(setup, postInput);
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
  it.each(BANK_SCENARIOS)('authDiscovery_$bank_ShouldCompleteFullChain', async row => {
    const setup = prepareAuthRow(row);
    const finalCtx = await runAuthChain(setup);
    expect(finalCtx.authDiscovery.has).toBe(true);
    assertAuthFinalShape(finalCtx);
  });
});
