/**
 * Phase H+ - cross-bank PRE-LOGIN per-phase factory (DEEP).
 *
 * <p>Honors the locked plan factory-depth expectation: drives the
 * full PRE -> ACTION -> POST -> FINAL chain per bank through real
 * production code paths.
 *
 * <ul>
 *   <li>PRE: {@link executePreLocateReveal} - probes reveal status
 *     via mediator.resolveVisible + commits IPreLoginDiscovery.</li>
 *   <li>ACTION: {@link executeFireRevealClicksSealed} - sealed click
 *     on resolved reveal target via executor.</li>
 *   <li>POST: {@link executeValidateForm} - validates form gate
 *     (password field visible), commits loginAreaReady.</li>
 *   <li>FINAL: {@link executeSignalToLogin} - succeeds when
 *     loginAreaReady was committed.</li>
 * </ul>
 *
 * <p>Per `coding-principle-guidlines.md` "Maximum 10 lines per
 * method" the `it.each` callback orchestrates via helpers + the
 * shared {@link unwrapOrThrow} from `_deepPhaseHelpers.ts`.
 */

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import {
  executeFireRevealClicksSealed,
  executePreLocateReveal,
  executeSignalToLogin,
  executeValidateForm,
} from '../../../../../Scrapers/Pipeline/Mediator/PreLogin/PreLoginPhaseActions.js';
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

/** Bundle returned by {@link preparePreLoginRow}. */
interface IPreLoginRowSetup {
  readonly row: IBankScenario;
  readonly subject: IDeepLoginTestSubject;
}

/**
 * Build the deep PRE-LOGIN test subject. Reuses
 * {@link buildDeepLoginContext} for mediator+executor wiring.
 *
 * @param row - Per-bank scenario row.
 * @returns Row + deep test subject.
 */
function preparePreLoginRow(row: IBankScenario): IPreLoginRowSetup {
  const cookies = loadAuthDiscoveryFixtureCookies(row.bank, 'last-good');
  const subject = buildDeepLoginContext({
    loginConfig: PLACEHOLDER_LOGIN_CONFIG,
    loginUrl: row.loginUrl,
    cookies,
  });
  return { row, subject };
}

/**
 * Drive PRE-LOGIN.PRE via production executePreLocateReveal.
 *
 * @param setup - Row + deep test subject.
 * @returns PRE-updated pipeline context.
 */
async function runPreLoginPre(setup: IPreLoginRowSetup): Promise<IPipelineContext> {
  if (!setup.subject.context.mediator.has) {
    throw new ScraperError(`PRELOGIN_PRE_NO_MEDIATOR bank=${setup.row.bank}`);
  }
  const mediator = setup.subject.context.mediator.value;
  const result = await executePreLocateReveal(mediator, setup.subject.context);
  return unwrapOrThrow(result, `PRELOGIN_PRE_FAILED bank=${setup.row.bank}`);
}

/**
 * Drive PRE-LOGIN.ACTION via production
 * executeFireRevealClicksSealed.
 *
 * @param setup - Row + deep test subject.
 * @param preCtx - PRE-updated pipeline context.
 * @returns ACTION-updated sealed action context.
 */
async function runPreLoginAction(
  setup: IPreLoginRowSetup,
  preCtx: IPipelineContext,
): Promise<IActionContext> {
  const actionCtx = toActionCtx(preCtx, setup.subject.executor);
  const result = await executeFireRevealClicksSealed(actionCtx);
  return unwrapOrThrow(result, `PRELOGIN_ACTION_FAILED bank=${setup.row.bank}`);
}

/**
 * Drive PRE-LOGIN.POST via production executeValidateForm.
 *
 * @param setup - Row + deep test subject.
 * @param preCtx - PRE-updated context (mediator/browser intact).
 * @returns POST-updated pipeline context.
 */
async function runPreLoginPost(
  setup: IPreLoginRowSetup,
  preCtx: IPipelineContext,
): Promise<IPipelineContext> {
  if (!preCtx.mediator.has) {
    throw new ScraperError(`PRELOGIN_POST_NO_MEDIATOR bank=${setup.row.bank}`);
  }
  const result = await executeValidateForm(preCtx.mediator.value, preCtx);
  return unwrapOrThrow(result, `PRELOGIN_POST_FAILED bank=${setup.row.bank}`);
}

/**
 * Drive PRE-LOGIN.FINAL via production executeSignalToLogin.
 *
 * @param setup - Row + deep test subject.
 * @param postCtx - POST-updated pipeline context.
 * @returns FINAL-updated pipeline context.
 */
function runPreLoginFinal(setup: IPreLoginRowSetup, postCtx: IPipelineContext): IPipelineContext {
  const result = executeSignalToLogin(postCtx);
  return unwrapOrThrow(result, `PRELOGIN_FINAL_FAILED bank=${setup.row.bank}`);
}

/**
 * Run the full PRE-LOGIN PRE -> ACTION -> POST -> FINAL chain.
 *
 * @param setup - Row + deep test subject.
 * @returns FINAL pipeline context.
 */
async function runPreLoginChain(setup: IPreLoginRowSetup): Promise<IPipelineContext> {
  const preCtx = await runPreLoginPre(setup);
  const actionCtx = await runPreLoginAction(setup, preCtx);
  const postInput = mergeActionDiagnostics(preCtx, actionCtx);
  const postCtx = await runPreLoginPost(setup, postInput);
  return runPreLoginFinal(setup, postCtx);
}

/**
 * Assert FINAL signaled loginAreaReady.
 *
 * @param finalCtx - Context after the chain.
 * @returns True after assertion.
 */
function assertPreLoginFinalShape(finalCtx: IPipelineContext): boolean {
  expect(finalCtx.loginAreaReady).toBe(true);
  return true;
}

describe('PRE-LOGIN-PHASE-FACTORY - DEEP cross-bank PRE-ACTION-POST-FINAL', () => {
  it.each(BANK_SCENARIOS)('preLogin_$bank_ShouldCompleteFullChain', async (row): Promise<void> => {
    const setup = preparePreLoginRow(row);
    const finalCtx = await runPreLoginChain(setup);
    assertPreLoginFinalShape(finalCtx);
  });
});
