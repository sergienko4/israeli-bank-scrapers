/**
 * Phase-scoped HANDOFF helpers — emit the single-line `[HANDOFF] { ... }`
 * debug summary every phase prints between its PRE and ACTION stages so
 * downstream phases can see (in human form) what the upstream resolver
 * discovered. The set is OCP-open: new phases register a resolver
 * function in {@link HANDOFF_MAP} and the dispatcher picks it up
 * without touching any other call site.
 *
 * <p>Extracted from `Pipeline/Types/BasePhase.ts` during Phase 12b
 * alongside the other pure helpers in this folder. The
 * {@link logHandoffSummary} dispatcher is the only public symbol the
 * Template Method invokes; the per-phase resolver functions stay
 * module-private so the registry shape is the single audit point.
 */

import type { Brand } from '../../Types/Brand.js';
import type { PhaseName } from '../../Types/Phase.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';

/** Handoff emit outcome — branded for Rule #15. */
export type DidEmitHandoff = Brand<boolean, 'DidEmitHandoff'>;

/**
 * Extract login field discoveries for HANDOFF.
 * @param ctx - Pipeline context.
 * @returns Field summary strings.
 */
function handoffLogin(ctx: IPipelineContext): readonly string[] {
  if (!ctx.loginFieldDiscovery.has) return [];
  const entries = [...ctx.loginFieldDiscovery.value.targets];
  return entries.map(([k, t]) => `${k}: '${t.contextId} > ${t.selector}'`);
}

/**
 * Extract pre-login discoveries for HANDOFF.
 * @param ctx - Pipeline context.
 * @returns Reveal status strings.
 */
function handoffPreLogin(ctx: IPipelineContext): readonly string[] {
  if (!ctx.preLoginDiscovery.has) return [];
  return [`reveal: ${ctx.preLoginDiscovery.value.privateCustomers}`];
}

/**
 * Extract dashboard discoveries for HANDOFF.
 * @param ctx - Pipeline context.
 * @returns Target summary strings.
 */
function handoffDashboard(ctx: IPipelineContext): readonly string[] {
  const target = ctx.diagnostics.dashboardTarget;
  if (!target) return [];
  return [`target: ${target.contextId} > ${target.selector}`];
}

/**
 * Extract scrape discoveries for HANDOFF.
 * @param ctx - Pipeline context.
 * @returns Card list strings.
 */
function handoffScrape(ctx: IPipelineContext): readonly string[] {
  if (!ctx.scrapeDiscovery.has) return [];
  const cardStr = ctx.scrapeDiscovery.value.qualifiedCards.join(',');
  return [`cards: [${cardStr}]`];
}

/** Phase-to-handler map for scoped HANDOFF. */
type HandoffFn = (ctx: IPipelineContext) => readonly string[];

/** OCP map — add entry for new phase. */
const HANDOFF_MAP: Partial<Record<string, HandoffFn>> = {
  login: handoffLogin,
  preLogin: handoffPreLogin,
  dashboard: handoffDashboard,
  scrape: handoffScrape,
};

/** Normalize phase name for lookup (pre-login → preLogin). */
const PHASE_KEY_MAP: Record<string, string> = {
  'pre-login': 'preLogin',
};

/**
 * Phase-scoped HANDOFF log — only logs discoveries for the current phase.
 * @param phaseName - Current phase name.
 * @param ctx - Context after PRE completed.
 * @param log - Logger instance.
 * @returns True when a handoff line was emitted, false on no-op skip
 * (no resolver for this phase, or no discoveries to summarise).
 */
export function logHandoffSummary(
  phaseName: PhaseName,
  ctx: IPipelineContext,
  log: IPipelineContext['logger'],
): DidEmitHandoff {
  const key = PHASE_KEY_MAP[phaseName] ?? phaseName;
  const resolver = HANDOFF_MAP[key];
  if (!resolver) return false as DidEmitHandoff;
  const parts = resolver(ctx);
  if (parts.length === 0) return false as DidEmitHandoff;
  const summary = parts.join(', ');
  log.debug({
    message: `[HANDOFF] { ${summary} }`,
  });
  return true as DidEmitHandoff;
}
