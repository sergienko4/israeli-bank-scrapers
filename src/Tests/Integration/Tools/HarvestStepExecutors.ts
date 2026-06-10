/**
 * Harvester step executors — one per `IHarvestStep.kind`.
 *
 * <p>Pure async functions over a Playwright `Page`. Each executor
 * performs its action then returns a {@link IStepExecutorResult}
 * describing what was emitted (snapshot path, response path, ...).
 * Callers compose executors via {@link executeHarvestStep}, which
 * dispatches by `kind` — no behaviour duplication.
 *
 * <p>Snapshots are written by the SAME helpers
 * {@link HarvestBankHtml} already uses, threaded in via the args
 * struct, so PR-A2.2 keeps backward compatibility with the legacy
 * pre-login recipe flow.
 *
 * <p>PR-A2.2: the `login` executor is now wired through the
 * production {@link createElementMediator} + {@link fillAndSubmit}
 * pipeline so the harvester can drive the LOGIN action when both
 * credentials AND a per-bank {@link ILoginConfig} are passed in. The
 * legacy "PR-A2.1 stub" error path is gone; absent credentials OR
 * absent login config produce a clean `skip` result so unattended
 * runs against creds-less banks still complete the rest of the recipe.
 */

import pino from 'pino';
import type { Page } from 'playwright-core';

import type { ILoginConfig } from '../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import ScraperError from '../../../Scrapers/Base/ScraperError.js';
import createElementMediator from '../../../Scrapers/Pipeline/Mediator/Elements/CreateElementMediator.js';
import { fillAndSubmit } from '../../../Scrapers/Pipeline/Mediator/Form/LoginFormActions.js';
import type { ScraperLogger } from '../../../Scrapers/Pipeline/Types/Debug.js';
import type { Option } from '../../../Scrapers/Pipeline/Types/Option.js';
import type { Procedure } from '../../../Scrapers/Pipeline/Types/Procedure.js';
import type { BankCredentials } from './CredentialLoader.js';
import {
  flushMatching,
  type IFlushArgs,
  type IResponseBufferHandle,
} from './NetworkResponseRecorder.js';
import type {
  IGotoStep,
  IHarvestStep,
  ILoginStep,
  IRecordResponseStep,
  IRevealStep,
  ISnapshotStep,
  IWaitForStep,
} from './RecipeStepTypes.js';

const DEFAULT_WAIT_TIMEOUT_MS = 30000;
const REVEAL_CLICK_TIMEOUT_MS = 15000;

/** Outcome of executing one harvest step. */
interface IStepExecutorResult {
  readonly stepName: string;
  readonly kind: IHarvestStep['kind'];
  readonly snapshotWritten: boolean;
  readonly responsePath?: string;
  readonly skipped?: string;
}

/** Snapshot writer thread-in — provided by the harvester host. */
type SnapshotWriter = (page: Page, stepName: string) => Promise<void>;

/** Bundle of args every executor accepts. */
interface IStepExecutorArgs {
  readonly page: Page;
  readonly outDir: string;
  readonly writeSnapshot: SnapshotWriter;
  readonly responseBuffer: IResponseBufferHandle;
  readonly credentials?: BankCredentials;
  readonly loginConfig?: ILoginConfig;
  readonly logger?: ScraperLogger;
}

/**
 * Build a successful result with snapshot flag.
 * @param step - The step that just ran.
 * @param snapshotWritten - True when a DOM snapshot was emitted.
 * @returns Structured executor result.
 */
function ok(step: IHarvestStep, snapshotWritten: boolean): IStepExecutorResult {
  return { stepName: step.stepName, kind: step.kind, snapshotWritten };
}

/**
 * Build a skipped result with a human-readable reason.
 * @param step - The step that was skipped.
 * @param skipped - Reason text.
 * @returns Structured executor result.
 */
function skip(step: IHarvestStep, skipped: string): IStepExecutorResult {
  return { stepName: step.stepName, kind: step.kind, snapshotWritten: false, skipped };
}

/**
 * Goto executor — navigates, optionally waits richer lifecycle, snapshots.
 * @param step - Goto step.
 * @param args - Shared executor args.
 * @returns Step result.
 */
async function executeGotoStep(
  step: IGotoStep,
  args: IStepExecutorArgs,
): Promise<IStepExecutorResult> {
  await args.page.goto(step.url, { waitUntil: 'domcontentloaded' });
  if (step.waitFor !== undefined) await args.page.waitForLoadState(step.waitFor);
  await args.writeSnapshot(args.page, step.stepName);
  return ok(step, true);
}

/**
 * Click the reveal element identified by visible text.
 *
 * @param page - Playwright page.
 * @param revealText - Visible text to locate and click.
 * @returns Resolved promise after the click settles.
 */
function clickRevealElement(page: Page, revealText: string): Promise<void> {
  return page
    .getByText(revealText, { exact: false })
    .first()
    .click({ timeout: REVEAL_CLICK_TIMEOUT_MS });
}

/**
 * Reveal executor — clicks element by visible text, snapshots.
 * @param step - Reveal step.
 * @param args - Shared executor args.
 * @returns Step result.
 */
async function executeRevealStep(
  step: IRevealStep,
  args: IStepExecutorArgs,
): Promise<IStepExecutorResult> {
  await clickRevealElement(args.page, step.revealText);
  await args.writeSnapshot(args.page, step.stepName);
  return ok(step, true);
}

/**
 * Snapshot executor — optional lifecycle wait then snapshot.
 * @param step - Snapshot step.
 * @param args - Shared executor args.
 * @returns Step result.
 */
async function executeSnapshotStep(
  step: ISnapshotStep,
  args: IStepExecutorArgs,
): Promise<IStepExecutorResult> {
  if (step.waitForLifecycle !== undefined) await args.page.waitForLoadState(step.waitForLifecycle);
  await args.writeSnapshot(args.page, step.stepName);
  return ok(step, true);
}

/**
 * Assert the waitFor step has at least one condition specified.
 *
 * @param step - The waitFor step to validate.
 * @returns True when the step is valid.
 */
function assertWaitForHasCondition(step: IWaitForStep): true {
  if (step.urlIncludes === undefined && step.textVisible === undefined) {
    throw new ScraperError(
      `waitFor step "${step.stepName}" requires urlIncludes or textVisible (both undefined)`,
    );
  }
  return true;
}

/**
 * Wait for a URL substring to appear in the current page URL.
 *
 * @param page - Playwright page.
 * @param fragment - URL substring to wait for.
 * @param timeout - Max wait time in milliseconds.
 * @returns True after the condition is met.
 */
async function waitForUrl(page: Page, fragment: string, timeout: number): Promise<true> {
  await page.waitForURL(u => u.toString().includes(fragment), { timeout });
  return true;
}

/**
 * Wait for visible text to appear on the page.
 *
 * @param page - Playwright page.
 * @param text - Visible text to wait for.
 * @param timeout - Max wait time in milliseconds.
 * @returns True after the condition is met.
 */
async function waitForText(page: Page, text: string, timeout: number): Promise<true> {
  await page.getByText(text, { exact: false }).first().waitFor({ timeout });
  return true;
}

/**
 * Conditionally await URL + visible-text waits for a wait-for step.
 *
 * @param page - Playwright page.
 * @param step - WaitFor step bundle.
 * @param timeout - Max wait time in milliseconds.
 * @returns Resolves once all configured waits complete.
 */
async function awaitConfiguredWaits(
  page: Page,
  step: IWaitForStep,
  timeout: number,
): Promise<void> {
  if (step.urlIncludes !== undefined) await waitForUrl(page, step.urlIncludes, timeout);
  if (step.textVisible !== undefined) await waitForText(page, step.textVisible, timeout);
}

/**
 * Wait-for executor — waits for URL substring or visible text, snapshots.
 * @param step - WaitFor step.
 * @param args - Shared executor args.
 * @returns Step result.
 */
async function executeWaitForStep(
  step: IWaitForStep,
  args: IStepExecutorArgs,
): Promise<IStepExecutorResult> {
  assertWaitForHasCondition(step);
  const timeout = step.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  await awaitConfiguredWaits(args.page, step, timeout);
  await args.writeSnapshot(args.page, step.stepName);
  return ok(step, true);
}

/**
 * Build the flush args from a record-response step and output directory.
 *
 * @param step - The record-response step providing URL pattern + capture config.
 * @param outDir - Directory where the response file will be written.
 * @returns Flush args bundle for {@link flushMatching}.
 */
function buildFlushArgs(step: IRecordResponseStep, outDir: string): IFlushArgs {
  return { urlPattern: step.urlPattern, outDir, captureAs: step.captureAs, methods: step.methods };
}

/**
 * Format the record-response executor result from the flush outcome.
 *
 * @param step - The record-response step.
 * @param flushResult - Option returned by {@link flushMatching}.
 * @returns Executor result with `skipped` or `responsePath` set accordingly.
 */
function formatRecordResult(
  step: IRecordResponseStep,
  flushResult: Option<string>,
): IStepExecutorResult {
  if (!flushResult.has)
    return { ...ok(step, true), skipped: `no buffered response matched "${step.urlPattern}"` };
  return { ...ok(step, true), responsePath: flushResult.value };
}

/**
 * Record-response executor — flushes a matching response from the
 * persistent buffer + snapshots current DOM.
 * @param step - RecordResponse step.
 * @param args - Shared executor args.
 * @returns Step result with optional `responsePath`.
 */
async function executeRecordResponseStep(
  step: IRecordResponseStep,
  args: IStepExecutorArgs,
): Promise<IStepExecutorResult> {
  const flushArgs = buildFlushArgs(step, args.outDir);
  const flushResult = await flushMatching(args.responseBuffer, flushArgs);
  await args.writeSnapshot(args.page, step.stepName);
  return formatRecordResult(step, flushResult);
}

/** Discriminated outcome of the login prereq gate. */
type LoginGate =
  | { readonly tag: 'skip'; readonly reason: string }
  | { readonly tag: 'ok'; readonly config: ILoginConfig; readonly creds: BankCredentials };

/**
 * Skip-reason builder for the no-login-config branch.
 * @returns Human-readable skip text.
 */
function noLoginConfigReason(): string {
  return 'no login config registered for bank; cannot drive login';
}

/**
 * Gate the login prereqs (credentials + per-bank LoginConfig).
 *
 * <p>Returns `skip` when either prereq is missing so unattended harvests
 * (e.g. CI runs against creds-less banks, or banks whose pipeline has
 * not registered a `LoginConfig`) complete the rest of the recipe
 * without aborting. Returns `ok` with the resolved config + creds when
 * the LOGIN ACTION is safe to drive.
 *
 * @param args - Shared executor args.
 * @returns LoginGate discriminating skip vs ok.
 */
function gateLoginPrereqs(args: IStepExecutorArgs): LoginGate {
  if (args.credentials === undefined) {
    return { tag: 'skip', reason: 'no credentials loaded; cannot drive login' };
  }
  if (args.loginConfig === undefined) {
    return { tag: 'skip', reason: noLoginConfigReason() };
  }
  return { tag: 'ok', config: args.loginConfig, creds: args.credentials };
}

/** Resolved login bundle threaded into {@link driveLoginAndSnapshot}. */
interface IDriveLoginSpec {
  readonly step: ILoginStep;
  readonly args: IStepExecutorArgs;
  readonly config: ILoginConfig;
  readonly creds: BankCredentials;
}

/**
 * Resolve the pipeline logger — caller-provided or silent fallback.
 * @param args - Shared executor args.
 * @returns Logger guaranteed non-null.
 */
function resolveLogger(args: IStepExecutorArgs): ScraperLogger {
  return args.logger ?? pino({ enabled: false });
}

/**
 * Run `fillAndSubmit` against the current page using the resolved login bundle.
 * @param spec - Resolved login bundle.
 * @returns Procedure carrying the submit outcome.
 */
async function runFillAndSubmit(spec: IDriveLoginSpec): Promise<Procedure<unknown>> {
  const mediator = createElementMediator(spec.args.page);
  const logger = resolveLogger(spec.args);
  const creds: Record<string, string> = { ...spec.creds };
  return fillAndSubmit({ mediator, config: spec.config, creds, logger });
}

/**
 * Assert the LOGIN fill+submit succeeded — throw with the wrapped
 * pipeline error message so the harvester operator sees the underlying
 * cause instead of a generic "failed" sentinel.
 * @param result - Procedure returned by `fillAndSubmit`.
 * @param stepName - Step name (recorded in the thrown error).
 * @returns True after the success branch passes.
 */
function assertLoginSuccess(result: Procedure<unknown>, stepName: string): true {
  if (!result.success) {
    throw new ScraperError(
      `harvester login step "${stepName}" failed during fill+submit: ${result.errorMessage}`,
    );
  }
  return true;
}

/**
 * Drive the LOGIN ACTION via the production `fillAndSubmit` and
 * snapshot the post-submit DOM. Extracted so {@link executeLoginStep}
 * stays under the 10-line cap.
 * @param spec - Resolved login bundle.
 * @returns Resolves once the snapshot is persisted.
 */
async function driveLoginAndSnapshot(spec: IDriveLoginSpec): Promise<void> {
  const result = await runFillAndSubmit(spec);
  assertLoginSuccess(result, spec.step.stepName);
  await spec.args.writeSnapshot(spec.args.page, spec.step.stepName);
}

/**
 * Login executor — PR-A2.2 wires the production
 * {@link createElementMediator} + {@link fillAndSubmit} pipeline so
 * the harvester can drive a real LOGIN ACTION when both
 * credentials AND a per-bank `LoginConfig` are passed in. Returns a
 * clean `skip` result when either prereq is missing so unattended
 * recipes still complete the remaining steps.
 * @param step - Login step (provides stepName for snapshot / error reporting).
 * @param args - Shared executor args (must include credentials + loginConfig to drive).
 * @returns Step result with snapshotWritten=true on drive, or skip reason on bypass.
 */
async function executeLoginStep(
  step: ILoginStep,
  args: IStepExecutorArgs,
): Promise<IStepExecutorResult> {
  const gate = gateLoginPrereqs(args);
  if (gate.tag === 'skip') return skip(step, gate.reason);
  await driveLoginAndSnapshot({ step, args, config: gate.config, creds: gate.creds });
  return ok(step, true);
}

/**
 * Dispatch table from step kind to executor. Single source of truth
 * for the discriminated union; new kinds add one row here.
 */
const STEP_EXECUTORS = {
  goto: executeGotoStep,
  reveal: executeRevealStep,
  snapshot: executeSnapshotStep,
  waitFor: executeWaitForStep,
  recordResponse: executeRecordResponseStep,
  login: executeLoginStep,
} as const;

/** Spec bundle for {@link executeHarvestStep} / internal dispatch. */
interface IExecuteHarvestSpec {
  readonly step: IHarvestStep;
  readonly args: IStepExecutorArgs;
}

/**
 * Execute one harvest step by dispatching to the kind-specific executor.
 * @param spec - Step + shared executor args.
 * @returns Step result.
 */
async function executeHarvestStep(spec: IExecuteHarvestSpec): Promise<IStepExecutorResult> {
  const { step, args } = spec;
  if (step.kind === 'goto') return STEP_EXECUTORS.goto(step, args);
  if (step.kind === 'reveal') return STEP_EXECUTORS.reveal(step, args);
  if (step.kind === 'snapshot') return STEP_EXECUTORS.snapshot(step, args);
  if (step.kind === 'waitFor') return STEP_EXECUTORS.waitFor(step, args);
  if (step.kind === 'recordResponse') return STEP_EXECUTORS.recordResponse(step, args);
  return STEP_EXECUTORS.login(step, args);
}

export type { IExecuteHarvestSpec, IStepExecutorArgs, IStepExecutorResult, SnapshotWriter };
export {
  executeGotoStep,
  executeHarvestStep,
  executeLoginStep,
  executeRecordResponseStep,
  executeRevealStep,
  executeSnapshotStep,
  executeWaitForStep,
  STEP_EXECUTORS,
};
export { waitForCredentialInputIfNeeded } from './HarvestWaitHelpers.js';
