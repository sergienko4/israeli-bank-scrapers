/**
 * Abstract BasePhase — Template Method for the 4-stage phase protocol.
 * PRE -> ACTION -> POST -> FINAL. Each stage returns Procedure<IPipelineContext>.
 *
 * run() is the ONLY entry point — bakes in Guard Clauses (Rule #15).
 * ACTION receives IActionContext (sealed — no discovery methods).
 * TypeScript compiler refuses resolveField/resolveVisible in action().
 */

import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import { extractActionMediator } from '../Mediator/Elements/CreateElementMediator.js';
import { setActivePhase, setActiveStage } from './ActiveState.js';
import { isMockTimingActive } from './Debug.js';
import type { PipelineLogEvent } from './LogEvent.js';
import { mockPolicyFor } from './MockPhasePolicy.js';
import { none, some } from './Option.js';
import type { PhaseName } from './Phase.js';
import type { IActionContext, IBootstrapContext, IPipelineContext } from './PipelineContext.js';
import type { Procedure } from './Procedure.js';
import { fail, succeed } from './Procedure.js';

/** Whether PRE produced a valid discovery payload for ACTION. */
type IsPrePayloadValid = boolean;

/** Phase outcome trace label. */
type TraceLabel = string;

/** Lookup for success/fail trace tags. */
const RESULT_TAG: Record<
  string,
  PipelineLogEvent['event'] extends TraceLabel ? TraceLabel : never
> = {
  true: 'OK',
  false: 'FAIL',
};

/**
 * Map Procedure success to trace tag.
 * @param r - Procedure result (any payload type).
 * @returns 'OK' or 'FAIL'.
 */
function traceTag<T>(r: Procedure<T>): TraceLabel {
  return RESULT_TAG[String(r.success)];
}

/**
 * Build sealed IActionContext from full context.
 * Strips browser/page/frame access. Only executor remains.
 * @param ctx - Full pipeline context after PRE.
 * @returns Sealed action context.
 */
/**
 * Extract sealed executor from full context.
 * Requires both mediator AND browser (for frame registry).
 * @param ctx - Full pipeline context.
 * @returns Option wrapping the action mediator.
 */
function extractExecutor(ctx: IPipelineContext): IActionContext['executor'] {
  if (!ctx.mediator.has) return none();
  if (!ctx.browser.has) return none();
  const page = ctx.browser.value.page;
  const sealed = extractActionMediator(ctx.mediator.value, page);
  return some(sealed);
}

/**
 * Build bootstrap context for INIT/TERMINATE — explicit object literal, NO spread.
 * Has browser (for launch/teardown) but NO mediator, NO executor.
 * @param ctx - Full pipeline context.
 * @returns IBootstrapContext with browser access.
 */
function buildBootstrapContext(ctx: IPipelineContext): IBootstrapContext {
  return {
    options: ctx.options,
    credentials: ctx.credentials,
    companyId: ctx.companyId,
    logger: ctx.logger,
    diagnostics: ctx.diagnostics,
    config: ctx.config,
    fetchStrategy: ctx.fetchStrategy,
    executor: none(),
    apiMediator: ctx.apiMediator,
    loginFieldDiscovery: ctx.loginFieldDiscovery,
    preLoginDiscovery: ctx.preLoginDiscovery,
    dashboard: ctx.dashboard,
    scrapeDiscovery: ctx.scrapeDiscovery,
    api: ctx.api,
    loginAreaReady: ctx.loginAreaReady,
    browser: ctx.browser,
  };
}

/**
 * Build sealed IActionContext — NEW object literal, NO spread.
 * If mediator exists: sealed (no browser, no mediator, no raw Page).
 * If no mediator (INIT/TERMINATE): returns IBootstrapContext (has browser).
 * @param ctx - Full pipeline context after PRE.
 * @returns Sealed action context.
 */
function buildActionContext(ctx: IPipelineContext): IActionContext {
  if (!ctx.mediator.has) return buildBootstrapContext(ctx);
  const executor = extractExecutor(ctx);
  return {
    options: ctx.options,
    credentials: ctx.credentials,
    companyId: ctx.companyId,
    logger: ctx.logger,
    diagnostics: ctx.diagnostics,
    config: ctx.config,
    fetchStrategy: ctx.fetchStrategy,
    executor,
    apiMediator: ctx.apiMediator,
    loginFieldDiscovery: ctx.loginFieldDiscovery,
    preLoginDiscovery: ctx.preLoginDiscovery,
    dashboard: ctx.dashboard,
    scrapeDiscovery: ctx.scrapeDiscovery,
    api: ctx.api,
    loginAreaReady: ctx.loginAreaReady,
  };
}

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
 * @returns True after logging.
 */
function logHandoffSummary(
  phaseName: PhaseName,
  ctx: IPipelineContext,
  log: IPipelineContext['logger'],
): true {
  const key = PHASE_KEY_MAP[phaseName] ?? phaseName;
  const resolver = HANDOFF_MAP[key];
  if (!resolver) return true;
  const parts = resolver(ctx);
  if (parts.length === 0) return true;
  const summary = parts.join(', ');
  log.debug({
    message: `[HANDOFF] { ${summary} }`,
  });
  return true;
}

/** Abstract base for all pipeline phases. */
abstract class BasePhase {
  /** Phase identifier — must match the pipeline execution order. */
  public abstract readonly name: PhaseName;

  /**
   * ACTION — the core execution. Receives SEALED context (no discovery).
   * Subclasses MUST implement. Compiler rejects resolveField/resolveVisible.
   * Returns Procedure<IActionContext> — runAction merges back into IPipelineContext.
   * @param ctx - Sealed action context from buildActionContext.
   * @param input - Same as ctx.
   * @returns Updated action context or failure.
   */
  public abstract action(
    ctx: IActionContext,
    input: IActionContext,
  ): Promise<Procedure<IActionContext>>;

  /**
   * Template Method — the ONLY way to execute a phase.
   * Enforces PRE -> ACTION -> POST -> FINAL with Guard Clauses.
   * ACTION receives sealed IActionContext (no discovery).
   * @param ctx - Pipeline context at phase entry.
   * @returns Final context after all 4 stages, or first failure.
   */
  public async run(ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> {
    const log = ctx.logger;
    setActivePhase(this.name);
    setActiveStage('PRE');
    const preResult = await this.runPre(ctx, log);
    if (!preResult.success) return preResult;
    const isPayloadValid = this.validatePrePayload(preResult.value);
    if (!isPayloadValid) return this.contractViolation();
    const actionResult = await this.runAction(preResult.value, log);
    if (!actionResult.success) return actionResult;
    const postResult = await this.runPost(ctx, actionResult.value, log);
    if (!postResult.success) return postResult;
    return this.runFinal(ctx, postResult.value, log);
  }

  /**
   * PRE — discovery step. Full mediator access.
   * @param _ctx - Pipeline context.
   * @param input - Pipeline context to pass through.
   * @returns Succeed with input (no-op default).
   */
  public pre(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    const result = succeed(input);
    return Promise.resolve(result);
  }

  /**
   * POST — validation after action. Full context restored.
   * @param _ctx - Pipeline context.
   * @param input - Pipeline context to pass through.
   * @returns Succeed with input (no-op default).
   */
  public post(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    const result = succeed(input);
    return Promise.resolve(result);
  }

  /**
   * FINAL — readiness signal. Full context.
   * @param _ctx - Pipeline context.
   * @param input - Pipeline context to pass through.
   * @returns Succeed with input (no-op default).
   */
  public final(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    const result = succeed(input);
    return Promise.resolve(result);
  }

  /**
   * Validate PRE produced a valid discovery payload for ACTION.
   * Override per phase. Default: no validation (INIT, TERMINATE).
   * @param _ctx - Context after PRE completed.
   * @returns True if payload valid for ACTION.
   */
  protected validatePrePayload(_ctx: IPipelineContext): IsPrePayloadValid {
    void _ctx;
    void this.name;
    return true;
  }

  /**
   * Build contract violation failure for invalid PRE payload.
   * @returns Failure Procedure with contract message.
   */
  private contractViolation(): Procedure<IPipelineContext> {
    const msg = `STAGE_CONTRACT_VIOLATION: ${this.name}.PRE OK but no target payload`;
    return fail(ScraperErrorTypes.Generic, msg);
  }

  /**
   * Execute PRE stage with trace logging.
   * MOCK_MODE: consults MockPhasePolicy; short-circuits when policy.pre=true.
   * @param ctx - Pipeline context.
   * @param log - Logger instance.
   * @returns PRE result.
   */
  private async runPre(
    ctx: IPipelineContext,
    log: IPipelineContext['logger'],
  ): Promise<Procedure<IPipelineContext>> {
    setActiveStage('PRE');
    if (isMockTimingActive() && mockPolicyFor(this.name).pre) {
      const mocked = succeed(ctx);
      log.debug({ event: 'phase-stage', phase: this.name, stage: 'PRE', result: 'OK' });
      return mocked;
    }
    const result = await this.pre(ctx, ctx);
    log.debug({ event: 'phase-stage', phase: this.name, stage: 'PRE', result: traceTag(result) });
    return result;
  }

  /**
   * Execute ACTION stage with sealed context and trace logging.
   * action() returns Procedure<IActionContext> — merge back into preVal for POST.
   * On failure: propagate with fail() (IActionContext failure has same shape).
   * On success: spread preVal + result.value → full IPipelineContext restored.
   * @param _ctx - Original pipeline context (unused — stages use preVal/restored/postVal).
   * @param preVal - Context after PRE.
   * @param log - Logger instance.
   * @returns ACTION result merged with full PRE context.
   */
  /**
   * Execute ACTION stage with sealed context and trace logging.
   * action() returns Procedure<IActionContext> — merge back into preVal.
   * @param preVal - Context after PRE.
   * @param log - Logger instance.
   * @returns ACTION result merged with full PRE context.
   */
  private async runAction(
    preVal: IPipelineContext,
    log: IPipelineContext['logger'],
  ): Promise<Procedure<IPipelineContext>> {
    logHandoffSummary(this.name, preVal, log);
    setActiveStage('ACTION');
    if (isMockTimingActive() && mockPolicyFor(this.name).action) {
      log.debug({ event: 'phase-stage', phase: this.name, stage: 'ACTION', result: 'OK' });
      return succeed(preVal);
    }
    const actionCtx = buildActionContext(preVal);
    const result = await this.action(actionCtx, actionCtx);
    log.debug({
      event: 'phase-stage',
      phase: this.name,
      stage: 'ACTION',
      result: RESULT_TAG[String(result.success)],
    });
    if (!result.success) return fail(result.errorType, result.errorMessage);
    const restored: IPipelineContext = { ...preVal, ...result.value };
    return succeed(restored);
  }

  /**
   * Execute POST stage with trace logging.
   * @param _ctx - Original pipeline context (unused — stages use preVal/restored/postVal).
   * @param restored - Full context restored after action.
   * @param log - Logger instance.
   * @returns POST result.
   */
  private async runPost(
    _ctx: IPipelineContext,
    restored: IPipelineContext,
    log: IPipelineContext['logger'],
  ): Promise<Procedure<IPipelineContext>> {
    setActiveStage('POST');
    if (isMockTimingActive() && mockPolicyFor(this.name).post) {
      log.debug({ event: 'phase-stage', phase: this.name, stage: 'POST', result: 'OK' });
      return succeed(restored);
    }
    const result = await this.post(restored, restored);
    log.debug({ event: 'phase-stage', phase: this.name, stage: 'POST', result: traceTag(result) });
    return result;
  }

  /**
   * Execute FINAL stage with trace logging.
   * @param _ctx - Original pipeline context (unused — stages use preVal/restored/postVal).
   * @param postVal - Context after POST.
   * @param log - Logger instance.
   * @returns FINAL result.
   */
  private async runFinal(
    _ctx: IPipelineContext,
    postVal: IPipelineContext,
    log: IPipelineContext['logger'],
  ): Promise<Procedure<IPipelineContext>> {
    setActiveStage('FINAL');
    if (isMockTimingActive() && mockPolicyFor(this.name).final) {
      log.debug({ event: 'phase-stage', phase: this.name, stage: 'FINAL', result: 'OK' });
      return succeed(postVal);
    }
    const result = await this.final(postVal, postVal);
    log.debug({ event: 'phase-stage', phase: this.name, stage: 'FINAL', result: traceTag(result) });
    return result;
  }
}

export default BasePhase;
export type { IsPrePayloadValid };
export { BasePhase };
