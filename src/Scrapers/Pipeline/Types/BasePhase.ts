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
import type { Brand } from './Brand.js';
import { isMockTimingActive } from './Debug.js';
import { dumpFixtureHtml } from './FixtureCapture.js';
import type { PipelineLogEvent } from './LogEvent.js';
import { mockPolicyFor } from './MockPhasePolicy.js';
import { none, some } from './Option.js';
import type { PhaseName } from './Phase.js';
import type { IActionContext, IBootstrapContext, IPipelineContext } from './PipelineContext.js';
import type { Procedure } from './Procedure.js';
import { fail, succeed } from './Procedure.js';
import { screenshotPath } from './RunLabel.js';

/** Trace tag — 'OK' or 'FAIL'. */
type TraceTagStr = Brand<string, 'TraceTagStr'>;
/** Handoff emit outcome — branded for Rule #15. */
type DidEmitHandoff = Brand<boolean, 'DidEmitHandoff'>;
/** PRE-payload validation outcome — branded for Rule #15. */
export type IsPrePayloadValid = Brand<boolean, 'IsPrePayloadValid'>;

/** Lookup for success/fail trace tags. */
const RESULT_TAG: Record<string, PipelineLogEvent['event'] extends string ? string : never> = {
  true: 'OK',
  false: 'FAIL',
};

/**
 * Map Procedure success to trace tag.
 * @param r - Procedure result (any payload type).
 * @returns 'OK' or 'FAIL'.
 */
function traceTag<T>(r: Procedure<T>): TraceTagStr {
  return RESULT_TAG[String(r.success)] as TraceTagStr;
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
 * @returns True when a handoff line was emitted, false on no-op skip
 * (no resolver for this phase, or no discoveries to summarise).
 */
function logHandoffSummary(
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
   * Bookended by automatic phase-level diagnostic screenshots
   * (`<bank>-<phase>-pre-<ts>.png` before PRE, `<bank>-<phase>-post-<ts>.png`
   * after FINAL). Both no-op outside trace mode (gated by RunLabel).
   * @param ctx - Pipeline context at phase entry.
   * @returns Final context after all 4 stages, or first failure.
   */
  public async run(ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> {
    setActivePhase(this.name);
    return await this.runStages(ctx, ctx.logger);
  }

  /**
   * PRE — discovery step. Full mediator access.
   * Default: pass through unchanged. Tagged with the active phase name so
   * subclasses inherit a real `this`-using body and `class-methods-use-this`
   * is satisfied without the legacy `void this.name` workaround.
   * @param _ctx - Pipeline context.
   * @param input - Pipeline context to pass through.
   * @returns Succeed with input (no-op default).
   */
  public pre(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    return this.passThrough(input);
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
    return this.passThrough(input);
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
    return this.passThrough(input);
  }

  /**
   * Phase-name accessor — subclasses call this from no-this overrides
   * (`pre`/`action`/`post`/`final`) to satisfy `class-methods-use-this`
   * without resorting to the `void this.name` workaround that S3735 flags.
   * @returns Phase name.
   */
  protected phaseName(): PhaseName {
    return this.name;
  }

  /**
   * Pass-through helper used by the PRE/POST/FINAL defaults. Tags the
   * payload with the active phase name so the inherited override
   * implicitly references `this`, keeping `class-methods-use-this`
   * happy without `void this.name`.
   * @param input - Pipeline context to forward unchanged.
   * @returns Succeed with input wrapped in a resolved promise.
   */
  protected passThrough(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
    input.logger.debug({ message: `[${this.name}] pass-through` });
    const result = succeed(input);
    return Promise.resolve(result);
  }

  /**
   * Validate PRE produced a valid discovery payload for ACTION.
   * Override per phase. Default: no validation (INIT, TERMINATE).
   * @param ctx - Context after PRE completed.
   * @returns True if payload valid for ACTION.
   */
  protected validatePrePayload(ctx: IPipelineContext): IsPrePayloadValid {
    return (Boolean(ctx) && this.name.length > 0) as IsPrePayloadValid;
  }

  /**
   * Drive the 4-stage protocol — split out so run() can bookend
   * screenshots without losing readability.
   * @param ctx - Pipeline context at phase entry.
   * @param log - Logger instance.
   * @returns Final context after all 4 stages, or first failure.
   */
  private async runStages(
    ctx: IPipelineContext,
    log: IPipelineContext['logger'],
  ): Promise<Procedure<IPipelineContext>> {
    setActiveStage('PRE');
    const pre = await this.runPre(ctx, log);
    if (!pre.success) return pre;
    if (!this.validatePrePayload(pre.value)) return this.contractViolation();
    await this.takePhaseScreenshot(pre.value, 'pre-done');
    return await this.runStagesAfterPre(ctx, pre.value, log);
  }

  /**
   * Drive ACTION → POST → FINAL with a screenshot after each stage success.
   * Split out so runStages stays inside the 10-line method ceiling.
   * @param ctx - Original phase-entry context (for stages that need it).
   * @param input - Context produced by PRE (validated payload).
   * @param log - Logger instance.
   * @returns Final phase context, or first stage failure.
   */
  private async runStagesAfterPre(
    ctx: IPipelineContext,
    input: IPipelineContext,
    log: IPipelineContext['logger'],
  ): Promise<Procedure<IPipelineContext>> {
    const action = await this.runAction(input, log);
    if (!action.success) return action;
    await this.takePhaseScreenshot(action.value, 'action-done');
    const post = await this.runPost(ctx, action.value, log);
    if (!post.success) return post;
    await this.takePhaseScreenshot(post.value, 'post-done');
    const finalResult = await this.runFinal(ctx, post.value, log);
    if (finalResult.success) await this.takePhaseScreenshot(finalResult.value, 'final-done');
    return finalResult;
  }

  /**
   * Capture a diagnostic screenshot AND fixture HTML dump for this phase.
   * No-op when (a) not in trace mode (`screenshotPath` returns empty), or
   * (b) the phase has no browser attached (INIT before launch / TERMINATE
   * after teardown / headless api-direct phases). The fixture HTML dump
   * is gated separately by DUMP_FIXTURES_DIR — see FixtureCapture.ts.
   * Called automatically by `runStages` after each successful stage —
   * phases never invoke this directly. Four bookend points per phase,
   * one per stage output: 'pre-done' (after PRE), 'action-done' (after
   * ACTION), 'post-done' (after POST), 'final-done' (after FINAL — phase
   * exit, the state next phase's PRE will see).
   * @param ctx - Pipeline context at the bookend.
   * @param suffix - Stage-output marker: 'pre-done' / 'action-done' /
   *   'post-done' / 'final-done'.
   * @returns True when a screenshot was captured, false on no-op skip
   * (no browser attached, or off-trace path resolution returned empty).
   */
  private async takePhaseScreenshot(
    ctx: IPipelineContext,
    suffix: 'pre-done' | 'action-done' | 'post-done' | 'final-done',
  ): Promise<boolean> {
    if (!ctx.browser.has) return false;
    const label = `${this.name}-${suffix}`;
    const target = screenshotPath(ctx.companyId, label);
    if (!target) return false;
    const page = ctx.browser.value.page;
    await page.screenshot({ path: target, fullPage: false }).catch((): false => false);
    ctx.logger.debug({ message: `screenshot: ${target}` });
    await dumpFixtureHtml(ctx, label);
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
export { BasePhase };
