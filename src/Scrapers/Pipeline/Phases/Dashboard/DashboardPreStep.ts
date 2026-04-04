/**
 * Dashboard PRE step — probe, resolve strategy, extract target.
 * Extracted from DashboardPhase.ts to respect max-lines.
 */

import {
  extractTransactionHref,
  NO_HREF,
  probeSuccessIndicators,
  resolveAbsoluteHref,
  resolveDashboardStrategy,
} from '../../Mediator/Dashboard/DashboardDiscovery.js';
import type { IElementMediator } from '../../Mediator/Elements/ElementMediator.js';
import { getDebug as createLogger } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';

const LOG = createLogger('dashboard-pre');

/**
 * Resolve TRIGGER target URL from mediator.
 * @param mediator - Element mediator.
 * @returns Absolute transaction href, or empty.
 */
async function resolveTriggerHref(mediator: IElementMediator): Promise<string> {
  const href = await extractTransactionHref(mediator);
  const pageUrl = mediator.getCurrentUrl();
  return resolveAbsoluteHref(href, pageUrl);
}

/** Human-readable match summary from probe. */
type MatchInfo = string;
/** Resolved dashboard target URL. */
type TargetUrl = string;

/** Bundled PRE resolution results. */
interface IPreResolution {
  readonly matchInfo: MatchInfo;
  readonly dashStrategy: 'BYPASS' | 'TRIGGER' | 'PROXY';
  readonly targetUrl: TargetUrl;
}

/**
 * Build PRE diagnostics with resolved strategy.
 * @param input - Pipeline context.
 * @param resolution - Resolved strategy info.
 * @returns Updated diagnostics.
 */
function buildPreDiag(
  input: IPipelineContext,
  resolution: IPreResolution,
): IPipelineContext['diagnostics'] {
  return {
    ...input.diagnostics,
    lastAction: `dashboard-pre (${resolution.matchInfo}, strategy=${resolution.dashStrategy})`,
    dashboardStrategy: resolution.dashStrategy,
    dashboardTargetUrl: resolution.targetUrl,
  };
}

/** Whether logging was emitted. */
type DidLog = boolean;

/**
 * Log the resolved PRE strategy.
 * @param resolution - Resolved strategy info.
 * @returns True after logging.
 */
function logPreStrategy(resolution: IPreResolution): DidLog {
  const target = maskVisibleText(resolution.targetUrl);
  const info = maskVisibleText(resolution.matchInfo);
  LOG.debug({
    event: 'generic-trace',
    phase: 'dashboard',
    message: `strategy=${resolution.dashStrategy} target=${target} (${info})`,
  });
  return true;
}

/**
 * Resolve target URL only when strategy is TRIGGER.
 * @param strategy - Dashboard strategy.
 * @param mediator - Element mediator.
 * @returns Target URL or NO_HREF.
 */
async function resolveTarget(
  strategy: IPreResolution['dashStrategy'],
  mediator: IElementMediator,
): Promise<string> {
  if (strategy === 'TRIGGER') return resolveTriggerHref(mediator);
  return NO_HREF;
}

/**
 * Execute PRE logic: probe, resolve strategy, extract target.
 * @param mediator - Element mediator.
 * @param input - Pipeline context.
 * @returns Updated context with strategy in diagnostics.
 */
async function executePre(
  mediator: IElementMediator,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const matchInfo = await probeSuccessIndicators(mediator);
  const dashStrategy = resolveDashboardStrategy(mediator.network, input.diagnostics.apiStrategy);
  const targetUrl = await resolveTarget(dashStrategy, mediator);
  const resolution: IPreResolution = { matchInfo, dashStrategy, targetUrl };
  logPreStrategy(resolution);
  const diag = buildPreDiag(input, resolution);
  return succeed({ ...input, diagnostics: diag });
}

export default executePre;
export { executePre };
