/**
 * POST-stage probe execution for the ApiDirectCall phase.
 * Fires the configured queryTag / urlTag once via the ApiMediator.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { WKQueryOperation } from '../../Registry/WK/QueriesWK.js';
import type { WKUrlGroup } from '../../Registry/WK/UrlsWK.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';
import type { IApiMediator } from '../Api/ApiMediator.js';
import { resolveApiMediator } from '../Api/ApiMediatorAccessor.js';
import { PHASE_LABEL, safeInvoke } from './ApiDirectCallActions.shared.js';
import type { IApiDirectCallConfig, IProbeConfig } from './IApiDirectCallConfig.js';

/** Probe response shape — opaque record so callers can introspect fields. */
type ProbeResponse = Record<string, unknown>;

const PROBE_QUERY_LABEL = 'POST probe query';
const PROBE_URL_LABEL = 'POST probe url';

/**
 * safeInvoke wrapper for the apiQuery probe path.
 * @param bus - ApiMediator.
 * @param tag - Query tag.
 * @returns Probe procedure.
 */
async function tryProbeQuery(
  bus: IApiMediator,
  tag: WKQueryOperation,
): Promise<Procedure<ProbeResponse>> {
  return safeInvoke(PROBE_QUERY_LABEL, () => bus.apiQuery<ProbeResponse>(tag, {}));
}

/**
 * safeInvoke wrapper for the apiGet probe path.
 * @param bus - ApiMediator.
 * @param tag - URL tag.
 * @returns Probe procedure.
 */
async function tryProbeUrl(bus: IApiMediator, tag: WKUrlGroup): Promise<Procedure<ProbeResponse>> {
  return safeInvoke(PROBE_URL_LABEL, () => bus.apiGet<ProbeResponse>(tag));
}

/**
 * Fire the configured probe — queryTag preferred over urlTag.
 * @param probe - Probe block from the API-direct-call config.
 * @param bus - ApiMediator instance.
 * @returns Probe procedure.
 */
async function runProbe(probe: IProbeConfig, bus: IApiMediator): Promise<Procedure<ProbeResponse>> {
  const view: { queryTag?: WKQueryOperation; urlTag?: WKUrlGroup } = probe;
  const { queryTag, urlTag } = view;
  if (queryTag !== undefined) return tryProbeQuery(bus, queryTag);
  if (urlTag !== undefined) return tryProbeUrl(bus, urlTag);
  return fail(ScraperErrorTypes.Generic, `${PHASE_LABEL} POST probe config missing`);
}

/**
 * Resolve the bus and execute the configured probe.
 * @param probe - Probe configuration block.
 * @param ctx - Pipeline context.
 * @returns Probe procedure.
 */
async function executeProbe(
  probe: IProbeConfig,
  ctx: IPipelineContext,
): Promise<Procedure<ProbeResponse>> {
  const busProc = resolveApiMediator(ctx, PHASE_LABEL);
  if (!isOk(busProc)) return busProc;
  return runProbe(probe, busProc.value);
}

/**
 * POST stage — exercise a lightweight authenticated call from the probe
 * config. Exactly one of queryTag / urlTag must be set.
 * @param config - API-direct-call config.
 * @param ctx - Pipeline context.
 * @returns Propagated POST result.
 */
async function runApiDirectCallPost(
  config: IApiDirectCallConfig,
  ctx: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (config.probe === undefined) return succeed(ctx);
  const probeProc = await executeProbe(config.probe, ctx);
  if (!isOk(probeProc)) return probeProc;
  return succeed(ctx);
}

export default runApiDirectCallPost;

export { runApiDirectCallPost };
