/**
 * MockInterceptor — serve local HTML snapshots instead of hitting the real bank.
 *
 * Activation: process.env.MOCK_MODE === '1' (checked at interceptor creation).
 * Effect: on the first phase, installs a page.route that fulfils every request
 *   with the HTML snapshot that corresponds to the currently-active phase.
 *   Phase transitions update the active snapshot without re-routing.
 *
 * Snapshots: tests/snapshots/{companyId}/{phaseName}.html
 *   Captured by SnapshotInterceptor when DUMP_SNAPSHOTS=1.
 *
 * IO helpers (file read, handler construction) live in MockInterceptorIO.ts
 * to keep this file under the 150-line Pipeline limit.
 */

import type { IPipelineInterceptor } from '../Types/Interceptor.js';
import type { PhaseName } from '../Types/Phase.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { succeed } from '../Types/Procedure.js';
import { getMockState, type IMockState } from './MockInterceptorIO.js';
import { buildHandler } from './MockRouteHandler.js';

/** Env flag name that activates mock mode. */
const ENV_FLAG = 'MOCK_MODE';

/** Route registration outcome — true on success, false when browser absent. */
type RouteResult = boolean;

/**
 * Check whether mock mode is enabled via env var.
 * @returns True when MOCK_MODE is set to a truthy value.
 */
function isMockEnabled(): RouteResult {
  const val = process.env[ENV_FLAG];
  return val === '1' || val === 'true';
}

/**
 * Register the context route if not already installed (idempotent).
 * INIT.pre installs it via installMockContextRoute — this is a belt-and-
 * braces safety net when an external run somehow bypassed INIT.
 * @param ctx - Pipeline context (must have browser).
 * @param state - Mutable state.
 * @returns True if route was registered (or already was), false if no browser.
 */
async function ensureRouted(ctx: IPipelineContext, state: IMockState): Promise<RouteResult> {
  if (state.isRouted) return true;
  if (!ctx.browser.has) return false;
  const { context } = ctx.browser.value;
  const handler = buildHandler(ctx.companyId, state);
  await context.route('**/*', handler);
  state.isRouted = true;
  return true;
}

/**
 * beforePhase pass-through for the disabled interceptor.
 * @param ctx - Current pipeline context.
 * @returns The same context, unchanged.
 */
function passThroughPhase(ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  const result = succeed(ctx);
  return Promise.resolve(result);
}

/**
 * Build a no-op interceptor used when MOCK_MODE is unset.
 * @returns Inert interceptor that passes context through unchanged.
 */
function buildNoopInterceptor(): IPipelineInterceptor {
  return { name: 'MockInterceptor(disabled)', beforePhase: passThroughPhase };
}

/**
 * Build the beforePhase handler for the active mock interceptor.
 * State is resolved lazily from ctx.companyId so it shares with the
 * INIT-time installer (installMockContextRoute) for the same bank.
 * @returns beforePhase function.
 */
/** Phases where the mock must force a page.reload() so the fresh snapshot
 * is served. Live banks transition into these without navigation (JS
 * swaps the DOM in-place), so without a reload the browser keeps the
 * prior phase's HTML and the PRE probe can't find the new elements. */
const RELOAD_REQUIRED: ReadonlySet<string> = new Set(['otp-fill']);

/**
 * Build the beforePhase handler — updates shared state, ensures the route
 * is installed, and triggers a reload for phases listed in RELOAD_REQUIRED.
 * @returns Playwright-compatible beforePhase callback.
 */
function buildActiveHandler(): (
  ctx: IPipelineContext,
  nextPhase: PhaseName,
) => Promise<Procedure<IPipelineContext>> {
  return async (ctx, nextPhase): Promise<Procedure<IPipelineContext>> => {
    const state: IMockState = getMockState(ctx.companyId);
    state.currentPhase = nextPhase;
    await ensureRouted(ctx, state);
    if (RELOAD_REQUIRED.has(nextPhase) && ctx.browser.has) {
      const { page } = ctx.browser.value;
      await page.reload({ waitUntil: 'domcontentloaded' }).catch((): false => false);
    }
    return succeed(ctx);
  };
}

/**
 * Build the active mock interceptor. Shared state is resolved per-ctx
 * at beforePhase time so state is coherent with the INIT-time installer.
 * @returns Stateful interceptor.
 */
function buildActiveInterceptor(): IPipelineInterceptor {
  return { name: 'MockInterceptor', beforePhase: buildActiveHandler() };
}

/**
 * Build the mock interceptor. Returns an inert interceptor when MOCK_MODE is
 * unset so the caller never has to check for absence.
 * @returns Interceptor instance (active or no-op).
 */
function createMockInterceptor(): IPipelineInterceptor {
  if (!isMockEnabled()) return buildNoopInterceptor();
  return buildActiveInterceptor();
}

export { createMockInterceptor, isMockEnabled };
