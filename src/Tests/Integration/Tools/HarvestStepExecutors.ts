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
 * struct, so PR-A2.1 keeps backward compatibility with the legacy
 * pre-login recipe flow.
 *
 * <p>The `login` executor is intentionally left as an
 * {@link ScraperError} stub in PR-A2.1 — wiring it requires the
 * pipeline `LoginConfig` resolver which lands in PR-A2.2 alongside
 * the live captures. Every other step kind is fully implemented and
 * unit-tested.
 */

import type { Page } from 'playwright-core';

import ScraperError from '../../../Scrapers/Base/ScraperError.js';
import type { BankCredentials } from './CredentialLoader.js';
import { flushMatching, type IResponseBufferHandle } from './NetworkResponseRecorder.js';
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
 * Reveal executor — clicks element by visible text, snapshots.
 * @param step - Reveal step.
 * @param args - Shared executor args.
 * @returns Step result.
 */
async function executeRevealStep(
  step: IRevealStep,
  args: IStepExecutorArgs,
): Promise<IStepExecutorResult> {
  await args.page
    .getByText(step.revealText, { exact: false })
    .first()
    .click({ timeout: REVEAL_CLICK_TIMEOUT_MS });
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
 * Wait-for executor — waits for URL substring or visible text, snapshots.
 * @param step - WaitFor step.
 * @param args - Shared executor args.
 * @returns Step result.
 */
async function executeWaitForStep(
  step: IWaitForStep,
  args: IStepExecutorArgs,
): Promise<IStepExecutorResult> {
  const timeout = step.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  if (step.urlIncludes !== undefined) {
    const fragment = step.urlIncludes;
    await args.page.waitForURL(u => u.toString().includes(fragment), { timeout });
  }
  if (step.textVisible !== undefined) {
    await args.page.getByText(step.textVisible, { exact: false }).first().waitFor({ timeout });
  }
  await args.writeSnapshot(args.page, step.stepName);
  return ok(step, true);
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
  const flushResult = await flushMatching(args.responseBuffer, {
    urlPattern: step.urlPattern,
    outDir: args.outDir,
    captureAs: step.captureAs,
    methods: step.methods,
  });
  await args.writeSnapshot(args.page, step.stepName);
  if (!flushResult.has) {
    const skipReason = `no buffered response matched "${step.urlPattern}"`;
    return { ...ok(step, true), skipped: skipReason };
  }
  return { ...ok(step, true), responsePath: flushResult.value };
}

/**
 * Login executor — PR-A2.1 stub. Wiring requires the production
 * pipeline `LoginConfig` resolver + per-bank field discovery, which
 * lands in PR-A2.2 alongside the live captures.
 * @param step - Login step (unused in stub).
 * @param args - Shared executor args (used for credentials check).
 * @returns Skip result when no credentials are loaded.
 * @throws When credentials are present (stub explicitly fails so the
 *   caller knows PR-A2.2 wiring is required).
 */
function executeLoginStep(step: ILoginStep, args: IStepExecutorArgs): Promise<IStepExecutorResult> {
  if (args.credentials === undefined) {
    const skipResult = skip(step, 'no credentials loaded; cannot drive login');
    return Promise.resolve(skipResult);
  }
  throw new ScraperError(
    `harvester login step not yet implemented (PR-A2.2); recipe step="${step.stepName}"`,
  );
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

/**
 * Execute one harvest step by dispatching to the kind-specific executor.
 * @param step - Recipe step.
 * @param args - Shared executor args.
 * @returns Step result.
 */
async function executeHarvestStep(
  step: IHarvestStep,
  args: IStepExecutorArgs,
): Promise<IStepExecutorResult> {
  switch (step.kind) {
    case 'goto':
      return STEP_EXECUTORS.goto(step, args);
    case 'reveal':
      return STEP_EXECUTORS.reveal(step, args);
    case 'snapshot':
      return STEP_EXECUTORS.snapshot(step, args);
    case 'waitFor':
      return STEP_EXECUTORS.waitFor(step, args);
    case 'recordResponse':
      return STEP_EXECUTORS.recordResponse(step, args);
    case 'login':
      return STEP_EXECUTORS.login(step, args);
    default: {
      const never: never = step;
      throw new ScraperError(`unknown harvest step kind: ${JSON.stringify(never)}`);
    }
  }
}

export type { IStepExecutorArgs, IStepExecutorResult, SnapshotWriter };
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
