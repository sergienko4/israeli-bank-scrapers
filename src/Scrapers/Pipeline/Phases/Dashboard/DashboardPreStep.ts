/**
 * Dashboard PRE step — probe, resolve strategy, extract target.
 * Extracted from DashboardPhase.ts to respect max-lines.
 */

import type { IElementMediator } from '../../Mediator/Elements/ElementMediator.js';
import {
  extractTransactionHref,
  NO_HREF,
  probeSuccessIndicators,
  resolveAbsoluteHref,
  resolveDashboardStrategy,
} from '../../Strategy/DashboardDiscoveryStep.js';
import { getDebug as createLogger } from '../../Types/Debug.js';
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
  readonly dashStrategy: 'BYPASS' | 'TRIGGER';
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
  const network = mediator.network;
  const dashStrategy = resolveDashboardStrategy(network);
  let targetUrl = NO_HREF;
  if (dashStrategy === 'TRIGGER') {
    targetUrl = await resolveTriggerHref(mediator);
  }
  LOG.debug('[PRE] strategy=%s target=%s (%s)', dashStrategy, targetUrl, matchInfo);
  const diag = buildPreDiag(input, { matchInfo, dashStrategy, targetUrl });
  return succeed({ ...input, diagnostics: diag });
}

export default executePre;
export { executePre };
