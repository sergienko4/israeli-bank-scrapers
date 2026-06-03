/**
 * DASHBOARD PRE phase orchestration — discover targets, build API
 * context, compose pass/fail procedure.
 *
 * <p>Co-located sibling of {@link "./DashboardPhaseActions.js"}. Split
 * out so the parent file stays under the LoC cap.
 */

import type { Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { some } from '../../Types/Option.js';
import type { IApiFetchContext, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';
import { DASHBOARD_SETTLE_MS } from '../Timing/TimingConfig.js';
import { countTxnTraffic, NO_HREF, probeSuccessIndicators } from './DashboardDiscovery.js';
import { buildApiIfAvailable, dumpDashboardText } from './DashboardPhaseActions.menu.js';
import { buildPreSummary } from './DashboardPhaseActions.pre.log.js';
import { resolveDashboardTargets } from './DashboardPhaseActions.targets.js';
import type { IDashboardTargets } from './DashboardPhaseActions.targets.types.js';
import { logWinningTarget } from './DashboardPhaseActions.winners.js';

/** Bundled PRE discovery results. */
interface IPreDiscoveryResult {
  readonly matchInfo: string;
  readonly targets: IDashboardTargets;
  readonly hasAny: boolean;
  readonly apiCtx: IApiFetchContext | false;
  readonly hasExistingTraffic: boolean;
}

/** Side-effect bundle from PRE's mediator priming. */
interface IDiscoveryPriming {
  readonly network: IElementMediator['network'];
  readonly matchInfo: string;
  readonly hasExistingTraffic: boolean;
  readonly hasAuth: boolean;
}

/**
 * Run the "prime + probe" prefix common to DASHBOARD PRE — wait for
 * network idle, cache auth, run success indicators, count traffic.
 * @param mediator - Element mediator (already unwrapped).
 * @returns Network handle + matchInfo + traffic/auth presence bits.
 */
async function primeDiscoveryNetwork(mediator: IElementMediator): Promise<IDiscoveryPriming> {
  const network = mediator.network;
  await mediator.waitForNetworkIdle(DASHBOARD_SETTLE_MS).catch((): false => false);
  await network.cacheAuthToken();
  const matchInfo = await probeSuccessIndicators(mediator);
  const hasExistingTraffic = countTxnTraffic(network, 0) > 0;
  const authToken = await network.discoverAuthToken();
  return { network, matchInfo, hasExistingTraffic, hasAuth: Boolean(authToken) };
}

/**
 * Compute the boolean `hasAny` for the resolved dashboard targets.
 * @param targets - Resolved targets.
 * @returns True when ANY of href / click / menu was resolved.
 */
function hasAnyTarget(targets: IDashboardTargets): boolean {
  return Boolean(targets.hrefTarget) || Boolean(targets.clickTarget) || Boolean(targets.menuTarget);
}

/**
 * Emit the DASHBOARD PRE summary log line with targets + auth +
 * existing-traffic flags.
 * @param input - Pipeline context with logger.
 * @param targets - Resolved targets.
 * @param priming - Priming bundle (used for auth/traffic bits).
 * @returns Always true so the caller stays expression-shaped.
 */
function logPreDiscovery(
  input: IPipelineContext,
  targets: IDashboardTargets,
  priming: IDiscoveryPriming,
): true {
  input.logger.debug({ message: buildPreSummary(targets, priming) });
  return true;
}

/** Bundled discovery inputs for {@link assembleDiscovery}. */
interface IAssembleDiscoveryArgs {
  readonly priming: IDiscoveryPriming;
  readonly targets: IDashboardTargets;
  readonly apiCtx: IApiFetchContext | false;
}

/**
 * Assemble the {@link IPreDiscoveryResult} from priming, targets, and
 * the built API context. Pulled out so {@link discoverDashboard} stays
 * under the LoC cap.
 * @param args - Bundled priming + targets + apiCtx.
 * @returns Discovery bundle for the PRE success branch.
 */
function assembleDiscovery(args: IAssembleDiscoveryArgs): IPreDiscoveryResult {
  const { priming, targets, apiCtx } = args;
  const hasAny = hasAnyTarget(targets);
  const { matchInfo, hasExistingTraffic } = priming;
  return { matchInfo, targets, hasAny, apiCtx, hasExistingTraffic };
}

/** Bundled probes for {@link runPrimingAndProbe}. */
interface IPrimingProbe {
  readonly priming: IDiscoveryPriming;
  readonly targets: IDashboardTargets;
  readonly apiCtx: IApiFetchContext | false;
}

/**
 * Sequence the three async probes PRE runs in order: priming → targets
 * → API context. Returns the bundled results.
 * @param input - Pipeline context.
 * @param mediator - Unwrapped element mediator.
 * @param page - Unwrapped browser page.
 * @returns Bundled priming + targets + apiCtx.
 */
async function runPrimingAndProbe(
  input: IPipelineContext,
  mediator: IElementMediator,
  page: Page,
): Promise<IPrimingProbe> {
  const priming = await primeDiscoveryNetwork(mediator);
  const targets = await resolveDashboardTargets(mediator, page);
  const apiCtx = await buildApiIfAvailable(input, priming.network);
  return { priming, targets, apiCtx };
}

/**
 * Core PRE discovery -- resolve targets. Zero clicks. NO strategy.
 * @param input - Pipeline context.
 * @param mediator - Unwrapped element mediator.
 * @param page - Unwrapped browser page.
 * @returns Discovery bundle.
 */
async function discoverDashboard(
  input: IPipelineContext,
  mediator: IElementMediator,
  page: Page,
): Promise<IPreDiscoveryResult> {
  const probe = await runPrimingAndProbe(input, mediator, page);
  logPreDiscovery(input, probe.targets, probe.priming);
  return assembleDiscovery(probe);
}

/**
 * Bundle every PRE-resolved target field that ACTION consumes downstream.
 * @param disc - Discovery bundle from {@link discoverDashboard}.
 * @returns Diagnostics fragment with all dashboard-target fields.
 */
function buildPreTargetFields(disc: IPreDiscoveryResult): Partial<IPipelineContext['diagnostics']> {
  return {
    dashboardTargetUrl: disc.targets.hrefTarget || NO_HREF,
    dashboardTarget: disc.targets.clickTarget || undefined,
    dashboardFallbackSelector: disc.targets.fallbackSelector || undefined,
    dashboardCandidateCount: disc.targets.clickCandidateCount,
    dashboardMenuTarget: disc.targets.menuTarget || undefined,
    dashboardTrafficExists: disc.hasExistingTraffic,
  };
}

/**
 * Build the diagnostics patch carrying every PRE-resolved field that
 * ACTION consumes.
 * @param input - Pipeline context.
 * @param disc - Discovery bundle from {@link discoverDashboard}.
 * @returns New diagnostics object for the success branch.
 */
function buildPreDiagnostics(
  input: IPipelineContext,
  disc: IPreDiscoveryResult,
): IPipelineContext['diagnostics'] {
  return {
    ...input.diagnostics,
    lastAction: `dashboard-pre (${disc.matchInfo})`,
    ...buildPreTargetFields(disc),
  };
}

/**
 * Compose the success-procedure context for PRE — optionally
 * attaches the discovered API context when one was built.
 * @param input - Pipeline context.
 * @param diag - Diagnostics patch (already built).
 * @param apiCtx - API context to attach, or false.
 * @returns Procedure carrying the updated context.
 */
function composePreSuccess(
  input: IPipelineContext,
  diag: IPipelineContext['diagnostics'],
  apiCtx: IApiFetchContext | false,
): Procedure<IPipelineContext> {
  if (!apiCtx) return succeed({ ...input, diagnostics: diag });
  return succeed({ ...input, diagnostics: diag, api: some(apiCtx) });
}

/**
 * Handle the "no target found" branch for PRE — dumps clickable text
 * for forensic logging then returns the fail-loud procedure.
 * @param input - Pipeline context.
 * @returns Fail-loud procedure for PRE.
 */
async function failPreNoTarget(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  await dumpDashboardText(input);
  return fail(ScraperErrorTypes.Generic, 'DASHBOARD PRE: no navigation target found');
}

/**
 * PRE: Cache auth, build API context, resolve targets.
 * Zero clicks -- Eye only. Stores IResolvedTarget for ACTION.
 * @param input - Pipeline context with mediator.
 * @returns Updated context with targets + api.
 */
async function executePreLocateNav(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'DASHBOARD PRE: no mediator');
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'DASHBOARD PRE: no browser');
  const disc = await discoverDashboard(input, input.mediator.value, input.browser.value.page);
  logWinningTarget(input, disc.targets);
  if (!disc.hasAny) return failPreNoTarget(input);
  const diag = buildPreDiagnostics(input, disc);
  return composePreSuccess(input, diag, disc.apiCtx);
}

export default executePreLocateNav;
export { executePreLocateNav };
