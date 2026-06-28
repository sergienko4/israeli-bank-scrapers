/**
 * Abstract BasePhase — Template Method for the 4-stage phase protocol.
 * PRE -> ACTION -> POST -> FINAL. Each stage returns Procedure<IPipelineContext>.
 *
 * run() is the ONLY entry point — bakes in Guard Clauses (Rule #15).
 * ACTION receives IActionContext (sealed — no discovery methods).
 * TypeScript compiler refuses resolveField/resolveVisible in action().
 *
 * <p>Phase 12b sub-step 4/4 (2026-06): the class body now lives beside
 * its module-private helpers under `Pipeline/Phases/Base/` — the more
 * semantically correct home for a phase-runtime collaborator. The
 * legacy import path {@link "../../Types/BasePhase.js"} continues to
 * resolve via a 5-line shim that re-exports `BasePhase` (default +
 * named) and the `IsPrePayloadValid` brand so external callers stay
 * source-compatible across the v8.5 release window.
 */

import type { Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { safeScreenshot } from '../../Mediator/Browser/SafeScreenshot.js';
import type { IPreludeSpec } from '../../Mediator/Elements/PagePrelude.js';
import { awaitPagePrelude, PRELUDE_NONE } from '../../Mediator/Elements/PagePrelude.js';
import { setActivePhase, setActiveStage } from '../../Types/ActiveState.js';
import type { Brand } from '../../Types/Brand.js';
import { isMockTimingActive } from '../../Types/Debug.js';
import { dumpFixtureHtml } from '../../Types/FixtureCapture.js';
import { mockPolicyFor } from '../../Types/MockPhasePolicy.js';
import type { Option } from '../../Types/Option.js';
import { none, some } from '../../Types/Option.js';
import type { PhaseName } from '../../Types/Phase.js';
import type { IActionContext, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import { screenshotPath } from '../../Types/RunLabel.js';
import { buildActionContext } from './ActionContextBuilder.js';
import { logHandoffSummary } from './HandoffHelpers.js';
import { PHASE_STAGE_EVENT, traceTag } from './PhaseTrace.js';

/** PRE-payload validation outcome — branded for Rule #15. */
export type IsPrePayloadValid = Brand<boolean, 'IsPrePayloadValid'>;

/** Uppercase stage tag emitted in trace events + ActiveState. */
type StageTagUpper = 'PRE' | 'ACTION' | 'POST' | 'FINAL';

/** Lowercase mock-policy hook key — direct mirror of the four runX methods. */
type StageHookKey = 'pre' | 'action' | 'post' | 'final';

/** Subset of StageHookKey used by handleStage (PRE has its own envelope in runStages). */
type StageBookendTag = Exclude<StageHookKey, 'pre'>;

/** Common return type for every stage runner — shrinks runPre/runPost/runFinal/runAction signatures inside the 10-LoC cap. */
type StageOutcome = Promise<Procedure<IPipelineContext>>;

/** Logger handle from the pipeline context (frequent param). */
type StageLogger = IPipelineContext['logger'];

/** Suffix tag accepted by takePhaseScreenshot — emitted before/after each of the four stage runners. */
type PhaseScreenshotSuffix =
  | 'pre-done'
  | 'action-done'
  | 'post-done'
  | 'final-done'
  | 'pre-fail'
  | 'action-fail'
  | 'post-fail'
  | 'final-fail';

/** Inputs to capturePageScreenshot — pre-narrowed browser handle + label/target. */
interface IScreenshotBundle {
  readonly page: Page;
  readonly label: string;
  readonly target: string;
}

/** Abstract base for all pipeline phases. */
abstract class BasePhase {
  /** Phase identifier — must match the pipeline execution order. */
  public abstract readonly name: PhaseName;

  /** Per-stage prelude table — subclasses override `prelude` to opt in. */
  private readonly _basePreludeSpecs: Record<StageTagUpper, IPreludeSpec> = {
    PRE: PRELUDE_NONE,
    ACTION: PRELUDE_NONE,
    POST: PRELUDE_NONE,
    FINAL: PRELUDE_NONE,
  };

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
   * after FINAL). Both no-op unless the opt-in `FORENSIC_TRACE` flag is set (gated by RunLabel).
   * @param ctx - Pipeline context at phase entry.
   * @returns Final context after all 4 stages, or first failure.
   */
  public run(ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> {
    setActivePhase(this.name);
    return this.runStages(ctx, ctx.logger);
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
   * Declarative page-readiness opt-in per stage. Override to request a
   * `'dom'` or `'spa'` prelude wait before this phase's PRE / ACTION /
   * POST / FINAL handler executes. Default {@link PRELUDE_NONE} keeps
   * phases that do not navigate at zero overhead. The
   * {@link "../Mediator/Elements/PagePrelude.js"} `awaitPagePrelude`
   * helper fires the wait + emits structured telemetry — phases do
   * not call it directly.
   *
   * @param stage - The stage about to execute (uppercase enum tag).
   * @returns Prelude specification for this stage; default `PRELUDE_NONE`.
   */
  protected prelude(stage: StageTagUpper): IPreludeSpec {
    return this._basePreludeSpecs[stage];
  }

  /**
   * Drive the 4-stage protocol — split out so run() can bookend
   * screenshots without losing readability. Wraps PRE in a snapshot
   * guard so unhandled exceptions still trigger the `pre-fail` bookend
   * before the error bubbles up to {@link "../../Core/Executor/PipelineExecutor.js"}
   * (which converts it to a Procedure failure via `wrapError`). CR PR #338 F3.
   * @param ctx - Pipeline context at phase entry.
   * @param log - Logger instance.
   * @returns Final context after all 4 stages, or first failure.
   */
  private async runStages(ctx: IPipelineContext, log: StageLogger): StageOutcome {
    setActiveStage('PRE');
    try {
      return await this.runStagesProtocol(ctx, log);
    } catch (error) {
      await this.takePhaseScreenshot(ctx, 'pre-fail');
      throw error;
    }
  }

  /**
   * The successful-path protocol body — extracted from {@link runStages}
   * so the snapshot-on-throw try/catch envelope fits inside the 10-line
   * method cap. Visits each guard / hook in order, exits on the first
   * failure with the appropriate snapshot bookend.
   * @param ctx - Pipeline context at phase entry.
   * @param log - Logger instance.
   * @returns Final context after all 4 stages, or first failure.
   */
  private async runStagesProtocol(ctx: IPipelineContext, log: StageLogger): StageOutcome {
    const pre = await this.runPre(ctx, log);
    if (!pre.success) return this.snapshotPreFail(ctx, pre);
    if (!this.validatePrePayload(pre.value)) return this.contractViolation();
    await this.takePhaseScreenshot(pre.value, 'pre-done');
    return this.runStagesAfterPre(ctx, pre.value, log);
  }

  /**
   * Drive ACTION → POST → FINAL with a screenshot after each stage success.
   * Split out so runStages stays inside the 10-line method ceiling. Each
   * stage routes through {@link handleStage} so failure ⇒ snapshot return,
   * success ⇒ `<stage>-done` bookend screenshot.
   * @param ctx - Original phase-entry context (for stages that need it).
   * @param input - Context produced by PRE (validated payload).
   * @param log - Logger instance.
   * @returns Final phase context, or first stage failure.
   */
  private async runStagesAfterPre(
    ctx: IPipelineContext,
    input: IPipelineContext,
    log: StageLogger,
  ): StageOutcome {
    const action = await this.handleStage(input, () => this.runAction(input, log), 'action');
    if (!action.success) return action;
    const post = await this.handleStage(
      action.value,
      () => this.runPost(ctx, action.value, log),
      'post',
    );
    if (!post.success) return post;
    return this.handleStage(post.value, () => this.runFinal(ctx, post.value, log), 'final');
  }

  /**
   * Stage envelope — run ACTION/POST/FINAL through the snapshot-on-failure /
   * screenshot-on-success bookend pattern. Wraps the runner so unhandled
   * exceptions still trigger the `<tag>-fail` snapshot before re-throwing
   * (CR PR #338 F3). The throw bubbles up to PipelineExecutor's
   * `wrapError` for Procedure-failure conversion — the failure message
   * format is owned in one place (PipelineReducer.ts) for the whole pipeline.
   * @param prevCtx - Context to snapshot on failure (caller's stage output).
   * @param runner - Stage runner (closure capturing `runAction`/`runPost`/`runFinal`).
   * @param tag - Stage tag for the success/fail screenshot label.
   * @returns Stage result — bookend side-effects already performed.
   */
  private async handleStage(
    prevCtx: IPipelineContext,
    runner: () => StageOutcome,
    tag: StageBookendTag,
  ): StageOutcome {
    try {
      return await this.runStageBookend(prevCtx, runner, tag);
    } catch (error) {
      await this.takePhaseScreenshot(prevCtx, `${tag}-fail`);
      throw error;
    }
  }

  /**
   * The successful-path body of {@link handleStage} — extracted so the
   * snapshot-on-throw try/catch envelope fits inside the 10-line method
   * cap. Performs the runner invocation + success/failure bookend.
   * @param prevCtx - Context to snapshot on failure.
   * @param runner - Stage runner.
   * @param tag - Stage tag for screenshot label.
   * @returns Stage result with bookend side-effects performed.
   */
  private async runStageBookend(
    prevCtx: IPipelineContext,
    runner: () => StageOutcome,
    tag: StageBookendTag,
  ): StageOutcome {
    const result = await runner();
    if (!result.success) return this.snapshotAndReturn(prevCtx, result, `${tag}-fail`);
    await this.takePhaseScreenshot(result.value, `${tag}-done`);
    return result;
  }

  /**
   * Capture a `pre-fail` bookend snapshot and forward the original PRE
   * failure. Extracted so `runStages` stays inside the 10-line cap and
   * the early-return shape matches the ACTION/POST/FINAL pattern owned
   * by {@link snapshotAndReturn}.
   * @param ctx - Pipeline context at phase entry (last known-good state).
   * @param pre - The PRE-stage failure to propagate verbatim.
   * @returns The same PRE failure after the screenshot attempt completes.
   */
  private async snapshotPreFail(
    ctx: IPipelineContext,
    pre: Procedure<IPipelineContext>,
  ): StageOutcome {
    await this.takePhaseScreenshot(ctx, 'pre-fail');
    return pre;
  }

  /**
   * Capture a diagnostic screenshot AND fixture HTML dump for this phase.
   * No-op when (a) not in trace mode (`screenshotPath` returns empty), or
   * (b) the phase has no browser attached (INIT before launch / TERMINATE
   * after teardown / headless api-direct phases). The fixture HTML dump
   * is gated separately by DUMP_FIXTURES_DIR — see FixtureCapture.ts.
   * Called automatically by `runStages` after each stage — phases never
   * invoke this directly. Eight bookend points per phase: four success
   * (`<stage>-done`) and four failure (`<stage>-fail`) markers.
   * @param ctx - Pipeline context at the bookend.
   * @param suffix - Stage-output marker (see {@link PhaseScreenshotSuffix}).
   * @returns True when a screenshot was captured, false on no-op skip
   *   (no browser attached, or off-trace path resolution returned empty).
   */
  private async takePhaseScreenshot(
    ctx: IPipelineContext,
    suffix: PhaseScreenshotSuffix,
  ): Promise<boolean> {
    if (!ctx.browser.has) return false;
    const label = `${this.name}-${suffix}`;
    const target = screenshotPath(ctx.companyId, label);
    if (!target) return false;
    const bundle: IScreenshotBundle = { page: ctx.browser.value.page, label, target };
    return BasePhase.capturePageScreenshot(ctx, bundle);
  }

  /**
   * Perform the actual screenshot capture + fixture HTML dump for a
   * bookend label. Split from {@link takePhaseScreenshot} so the no-op
   * guards stay above the 10-line cap and the disk-write path is
   * independently testable. Static because it carries no per-instance
   * state — the Option-narrowed browser handle is bundled via
   * {@link IScreenshotBundle} so a single object param keeps the
   * signature inside the `@typescript-eslint/max-params: 3` cap.
   * @param ctx - Pipeline context (for logger + fixture dump).
   * @param bundle - Pre-narrowed page handle + bookend label + target path.
   * @returns True if `safeScreenshot` reported a successful write.
   */
  private static async capturePageScreenshot(
    ctx: IPipelineContext,
    bundle: IScreenshotBundle,
  ): Promise<boolean> {
    const didCapture = await safeScreenshot(bundle.page, { path: bundle.target, fullPage: false });
    if (didCapture) ctx.logger.debug({ message: `screenshot: ${bundle.target}` });
    await dumpFixtureHtml(ctx, bundle.label);
    return didCapture;
  }

  /**
   * Bundle a failure-snapshot capture with the early-return so each
   * failing-stage branch in {@link runStagesAfterPre} stays inside the
   * 10-line method ceiling. Forensic-grade only — the screenshot is
   * non-fatal: on disk-write failure the original Procedure result is
   * still returned unchanged.
   *
   * @param ctx - Pipeline context to screenshot (the LAST successful
   *   stage's output; {@link takePhaseScreenshot} no-ops without browser).
   * @param result - Original failure Procedure to forward to the caller.
   * @param label - Failure-suffix tag (e.g. `'action-fail'`).
   * @returns The same failure Procedure passed in, after the
   *   screenshot attempt completes.
   */
  private async snapshotAndReturn(
    ctx: IPipelineContext,
    result: Procedure<IPipelineContext>,
    label: 'action-fail' | 'post-fail' | 'final-fail',
  ): StageOutcome {
    await this.takePhaseScreenshot(ctx, label);
    return result;
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
   * Emit the structured `phase-stage` debug event for a completed stage.
   * Centralizes the 4-key payload so each runX orchestrator collapses
   * to a single call site (drops 4 lines per stage runner — the lever
   * that brings runPre/runPost/runFinal inside the 10-line cap).
   * @param log - Logger instance.
   * @param stage - Uppercase stage tag emitted on the wire.
   * @param result - Procedure result whose success bit becomes the tag.
   */
  private logStage<T>(log: StageLogger, stage: StageTagUpper, result: Procedure<T>): void {
    const tag = traceTag(result);
    log.debug({ event: PHASE_STAGE_EVENT, phase: this.name, stage, result: tag });
  }

  /**
   * MOCK_MODE short-circuit shared across all four stage runners. When the
   * mock-policy table opts this phase's stage in, emits the `OK` trace
   * event and returns `some(succeed(ctx))` so the caller can early-out;
   * otherwise returns `none()` and the real path runs. The hook key is
   * derived from the lowercased stage tag — kept inside the helper so
   * the param count fits the `max-params: 3` cap.
   * @param log - Logger instance.
   * @param stage - Uppercase stage tag (used for trace event + lowercase mock-policy lookup).
   * @param ctx - Context to pass through on mock activation.
   * @returns `some(succeed(ctx))` when mocked, `none()` otherwise.
   */
  private mockShortCircuit<T extends IPipelineContext>(
    log: StageLogger,
    stage: StageTagUpper,
    ctx: T,
  ): Option<Procedure<T>> {
    const hookKey = stage.toLowerCase() as StageHookKey;
    if (!isMockTimingActive() || !mockPolicyFor(this.name)[hookKey]) return none();
    const result = succeed(ctx);
    this.logStage(log, stage, result);
    return some(result);
  }

  /**
   * Run the page-readiness prelude for a stage. Extracted so each runX
   * orchestrator drops a 2-line lookup/await sequence and stays inside
   * the 10-line cap.
   * @param stage - Uppercase stage tag (selects the prelude spec).
   * @param ctx - Context whose page the prelude awaits against.
   */
  private async runPrelude(stage: StageTagUpper, ctx: IPipelineContext): Promise<void> {
    const spec = this.prelude(stage);
    await awaitPagePrelude(ctx, spec);
  }

  /**
   * Build the sealed `IActionContext` and invoke the subclass `action()`.
   * Extracted so {@link runAction} stays inside the 10-line cap and the
   * sealed-context construction is asserted in one place.
   * @param preVal - Full PRE context (carries the discovery slice).
   * @returns ACTION result over the sealed `IActionContext`.
   */
  private async invokeAction(preVal: IPipelineContext): Promise<Procedure<IActionContext>> {
    const actionCtx = buildActionContext(preVal);
    return this.action(actionCtx, actionCtx);
  }

  /**
   * Merge ACTION's `Procedure<IActionContext>` back into the full
   * `IPipelineContext` produced by PRE. On failure: propagate verbatim
   * with `fail()`. On success: spread preVal + result.value to restore
   * the discovery slice the sealed `IActionContext` intentionally hid.
   * Static — the merge is referentially transparent (no `this`).
   * @param preVal - Full PRE context (carries the discovery slice).
   * @param result - ACTION result over the sealed `IActionContext`.
   * @returns Procedure of the restored full pipeline context.
   */
  private static mergeActionResult(
    preVal: IPipelineContext,
    result: Procedure<IActionContext>,
  ): Procedure<IPipelineContext> {
    if (!result.success) return fail(result.errorType, result.errorMessage);
    const restored: IPipelineContext = { ...preVal, ...result.value };
    return succeed(restored);
  }

  /**
   * Execute PRE stage with trace logging. MOCK_MODE: consults
   * MockPhasePolicy; short-circuits when policy.pre=true.
   * @param ctx - Pipeline context.
   * @param log - Logger instance.
   * @returns PRE result.
   */
  private async runPre(ctx: IPipelineContext, log: StageLogger): StageOutcome {
    setActiveStage('PRE');
    const mocked = this.mockShortCircuit(log, 'PRE', ctx);
    if (mocked.has) return mocked.value;
    await this.runPrelude('PRE', ctx);
    const result = await this.pre(ctx, ctx);
    this.logStage(log, 'PRE', result);
    return result;
  }

  /**
   * Execute ACTION stage with sealed context and trace logging.
   * action() returns Procedure<IActionContext> — {@link mergeActionResult}
   * restores the discovery slice on success / propagates on failure.
   * @param preVal - Context after PRE.
   * @param log - Logger instance.
   * @returns ACTION result merged with full PRE context.
   */
  private async runAction(preVal: IPipelineContext, log: StageLogger): StageOutcome {
    setActiveStage('ACTION');
    logHandoffSummary(this.name, preVal, log);
    const mocked = this.mockShortCircuit(log, 'ACTION', preVal);
    if (mocked.has) return mocked.value;
    await this.runPrelude('ACTION', preVal);
    const result = await this.invokeAction(preVal);
    this.logStage(log, 'ACTION', result);
    return BasePhase.mergeActionResult(preVal, result);
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
    log: StageLogger,
  ): StageOutcome {
    setActiveStage('POST');
    const mocked = this.mockShortCircuit(log, 'POST', restored);
    if (mocked.has) return mocked.value;
    await this.runPrelude('POST', restored);
    const result = await this.post(restored, restored);
    this.logStage(log, 'POST', result);
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
    log: StageLogger,
  ): StageOutcome {
    setActiveStage('FINAL');
    const mocked = this.mockShortCircuit(log, 'FINAL', postVal);
    if (mocked.has) return mocked.value;
    await this.runPrelude('FINAL', postVal);
    const result = await this.final(postVal, postVal);
    this.logStage(log, 'FINAL', result);
    return result;
  }
}

export default BasePhase;
export { BasePhase };
