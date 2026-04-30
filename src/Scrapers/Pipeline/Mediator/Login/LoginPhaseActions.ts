/**
 * LOGIN phase Mediator actions — PRE/ACTION/POST/FINAL.
 * Phase orchestrates ONLY. All logic here.
 *
 * PRE:    discover credential form (checkReadiness + preAction + field discovery)
 * ACTION: fill from discovery + submit (sealed IActionContext, no mediator)
 * POST:   validate OK or error (error discovery + traffic wait)
 * FINAL:  prove dashboard loaded → signal to DASHBOARD (cookie audit + API strategy)
 */

import type { Frame, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../Base/Config/LoginConfigTypes.js';
import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { IFieldConfig } from '../../../Base/Interfaces/Config/FieldConfig.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { WK_LOGIN_FORM } from '../../Registry/WK/LoginWK.js';
import { toErrorMessage } from '../../Types/ErrorUtils.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import { none, type Option, some } from '../../Types/Option.js';
import type {
  IActionContext,
  ILoginFieldDiscovery,
  ILoginState,
  IPipelineContext,
  IResolvedTarget,
  LoginFieldKey,
} from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import { screenshotPath } from '../../Types/RunLabel.js';
import { waitForPostLoginTraffic } from '../Auth/PostLoginTrafficProbe.js';
import { computeContextId } from '../Elements/ActionExecutors.js';
import type { IElementMediator, IRaceResult } from '../Elements/ElementMediator.js';
import type { IFormAnchor } from '../Form/FormAnchor.js';
import { fillFromDiscovery } from '../Form/LoginFormActions.js';
import { passwordFirst } from '../Form/LoginScopeResolver.js';
import { runPostCallback } from '../Form/PostActionResolver.js';

/** Timeout for post-login redirect settle. */
const REDIRECT_SETTLE_MS = 15000;

/**
 * Take a diagnostic screenshot to C:\tmp. When DUMP_FIXTURES_DIR
 * env var is set, ALSO dump main-frame HTML + iframe HTML to
 * <DUMP_FIXTURES_DIR>/<bank>/<label>.html for ZERO-NETWORK mock tests.
 * @param input - Pipeline context with browser.
 * @param label - Screenshot label.
 * @returns True after screenshot.
 */
async function takeScreenshot(input: IPipelineContext, label: DiagLabel): Promise<true> {
  if (!input.browser.has) return true;
  const page = input.browser.value.page;
  const path = screenshotPath(input.companyId, label);
  await page.screenshot({ path }).catch((): false => false);
  input.logger.debug({ message: `screenshot: ${path}` });
  await dumpFixtureHtml(input, label);
  return true;
}

/**
 * When DUMP_FIXTURES_DIR env var is set, save page + iframe HTML so
 * a mock E2E test can serve the same bytes offline. No-op otherwise.
 * @param input - Pipeline context with browser.
 * @param label - Same label used by the screenshot path.
 * @returns True after dump (or no-op).
 */
async function dumpFixtureHtml(input: IPipelineContext, label: DiagLabel): Promise<true> {
  const rootEnv = process.env.DUMP_FIXTURES_DIR;
  if (rootEnv === undefined || rootEnv.length === 0) return true;
  if (!input.browser.has) return true;
  const page = input.browser.value.page;
  const bank = input.companyId;
  const bankDir = `${rootEnv}/${bank}`.replace(/\\/g, '/');
  await writeFrameHtml({ page, bankDir, label, input }).catch((): false => false);
  return true;
}

/** Bundled args for writing frame fixtures (3-param ceiling). */
interface IWriteFrameArgs {
  readonly page: Page;
  readonly bankDir: string;
  readonly label: DiagLabel;
  readonly input: IPipelineContext;
}

/** One iframe html snapshot ready to write. */
interface IIframeSnapshot {
  readonly html: string;
}

/**
 * Collect every child-frame's HTML in parallel (skips main frame and
 * empty frames). Keeps frame order so iframe indices stay stable.
 * @param page - Playwright page.
 * @returns Non-empty iframe snapshots.
 */
/**
 * Read one frame's HTML content, swallowing navigation/detached errors.
 * @param frame - Target frame.
 * @returns HTML string (empty on error).
 */
async function readFrameContent(frame: Frame): Promise<string> {
  return frame.content().catch((): FrameHtmlFallback => '');
}

/**
 * Async pluck of each child frame's HTML in parallel. Keeps frame order
 * so iframe indices stay stable.
 * @param page - Playwright page.
 * @returns Non-empty iframe snapshots.
 */
async function collectIframeSnapshots(page: Page): Promise<readonly IIframeSnapshot[]> {
  const mainFrame = page.mainFrame();
  const children = page.frames().filter((f): IsChildFrame => f !== mainFrame);
  const readPromises = children.map(readFrameContent);
  const htmls = await Promise.all(readPromises);
  const nonEmpty = htmls.filter((html): IsNonEmptyHtml => html.length > 0);
  return nonEmpty.map((html): IIframeSnapshot => ({ html }));
}

/** An iframe snapshot paired with its stable index. */
interface IIndexedSnapshot {
  readonly html: string;
  readonly idx: number;
}

import type * as FsPromisesNs from 'node:fs/promises';

type FsPromisesModule = typeof FsPromisesNs;

/** Bundled args for writing one iframe file (3-param ceiling). */
interface IWriteIframeArgs {
  readonly fs: FsPromisesModule;
  readonly outer: IWriteFrameArgs;
  readonly snap: IIndexedSnapshot;
}

/**
 * Build the write-promise for a single iframe snapshot.
 * @param args - Bundled fs + outer + snapshot.
 * @returns Write promise.
 */
function writeIframeSnapshot(args: IWriteIframeArgs): Promise<void> {
  const idxStr = String(args.snap.idx);
  const filePath = `${args.outer.bankDir}/${args.outer.label}-iframe-${idxStr}.html`;
  return args.fs.writeFile(filePath, args.snap.html, 'utf8');
}

/**
 * Write page.content() to <bankDir>/<label>.html and each iframe to
 * <bankDir>/<label>-iframe-<idx>.html.
 * @param args - Bundled page + bankDir + label + context.
 * @returns True after write.
 */
async function writeFrameHtml(args: IWriteFrameArgs): Promise<true> {
  const fs = await import('node:fs/promises');
  await fs.mkdir(args.bankDir, { recursive: true });
  const mainHtml = await args.page.content();
  await fs.writeFile(`${args.bankDir}/${args.label}.html`, mainHtml, 'utf8');
  args.input.logger.debug({ message: `fixture: ${args.bankDir}/${args.label}.html` });
  const snapshots = await collectIframeSnapshots(args.page);
  const indexed = snapshots.map((s, idx): { html: string; idx: number } => ({
    html: s.html,
    idx,
  }));
  const writePromises = indexed.map(
    (s): Promise<void> => writeIframeSnapshot({ fs, outer: args, snap: s }),
  );
  await Promise.all(writePromises);
  return true;
}

/** Diagnostic screenshot label. */
type DiagLabel = string;
/** Whether URL changed from login page. */
type IsRedirect = boolean;
/** Frame HTML snapshot string (empty on read failure). */
type FrameHtmlFallback = string;
/** Array.filter predicate — excludes the main frame from child-frame walks. */
type IsChildFrame = boolean;
/** Array.filter predicate — keeps frames whose HTML snapshot is non-empty. */
type IsNonEmptyHtml = boolean;
/** Array.find predicate — picks the first frame-scan that reported errors. */
type HasScanErrors = boolean;

/** Candidate value extracted from race result. */
type CandidateValue = string;
/** Candidate kind extracted from race result. */
type CandidateKind = string;
/** CSS/XPath selector string. */
type SelectorStr = string;
/** URL pathname with trailing slashes stripped (root returned as "/"). */
type LoginPathname = string;

/**
 * Run checkReadiness if configured — returns failure Procedure or false.
 * @param config - Login config.
 * @param page - Browser page.
 * @returns Failure Procedure on error, false on success/skip.
 */
async function runCheckReadiness(
  config: ILoginConfig,
  page: Page,
): Promise<Procedure<IPipelineContext> | false> {
  if (!config.checkReadiness) return false;
  try {
    await config.checkReadiness(page);
    return false;
  } catch (err) {
    const msg = toErrorMessage(err as Error);
    return fail(ScraperErrorTypes.Generic, `LOGIN PRE: checkReadiness — ${msg}`);
  }
}

/**
 * Run preAction if configured — returns the active frame.
 * @param config - Login config.
 * @param page - Browser page.
 * @returns Active frame (Page or Frame), or failure Procedure.
 */
async function runPreAction(config: ILoginConfig, page: Page): Promise<Procedure<Page | Frame>> {
  if (!config.preAction) return succeed(page as Page | Frame);
  try {
    const frame = await config.preAction(page);
    const activeFrame: Page | Frame = frame ?? page;
    return succeed(activeFrame);
  } catch (err) {
    const msg = toErrorMessage(err as Error);
    return fail(ScraperErrorTypes.Generic, `LOGIN PRE: preAction — ${msg}`);
  }
}

/** Bundled arguments for resolving one field in PRE. */
interface IResolveFieldArgs {
  readonly mediator: IElementMediator;
  readonly field: IFieldConfig;
  readonly activeFrame: Page | Frame;
  readonly page: Page;
  readonly logger: IPipelineContext['logger'];
}

/**
 * Resolve one credential field and build an IResolvedTarget.
 * @param args - Bundled resolve arguments.
 * @returns Resolved target or false if not found.
 */
async function resolveOneField(args: IResolveFieldArgs): Promise<IResolvedTarget | false> {
  const key = args.field.credentialKey;
  const msg = `PRE resolving ${maskVisibleText(key)}`;
  args.logger.debug({ message: msg });
  const result = await args.mediator.resolveField(key, args.field.selectors, args.activeFrame);
  if (!result.success) return false;
  const contextId = computeContextId(result.value.context, args.page);
  return {
    selector: result.value.selector,
    contextId,
    kind: result.value.resolvedKind ?? result.value.resolvedVia,
    candidateValue: key,
  };
}

/** Bundled args for accumulating one resolved field. */
interface IAccumulateArgs {
  readonly targets: Map<LoginFieldKey, IResolvedTarget>;
  readonly key: LoginFieldKey;
  readonly target: IResolvedTarget | false;
}

/** Lookup for field resolution trace labels. */
const FIELD_RESULT_TAG: Record<string, string> = { true: 'FOUND', false: 'NOT_FOUND' };

/**
 * Accumulate one resolved field into the targets map.
 * @param args - Bundled accumulate arguments.
 * @param logger - Pipeline logger.
 * @returns Updated targets map.
 */
function accumulateTarget(
  args: IAccumulateArgs,
  logger: IPipelineContext['logger'],
): Map<LoginFieldKey, IResolvedTarget> {
  const tag = FIELD_RESULT_TAG[String(!!args.target)];
  logger.debug({ field: maskVisibleText(args.key), result: tag });
  if (args.target) args.targets.set(args.key, args.target);
  return args.targets;
}

/** Bundled arguments for discovering all login fields. */
interface IDiscoverFieldsArgs {
  readonly mediator: IElementMediator;
  readonly config: ILoginConfig;
  readonly activeFrame: Page | Frame;
  readonly page: Page;
  readonly logger: IPipelineContext['logger'];
}

/** Accumulator for field discovery reduce. */
interface IFieldAccum {
  readonly targets: Map<LoginFieldKey, IResolvedTarget>;
  readonly formAnchor: Option<IFormAnchor>;
}

/**
 * Resolve one field and accumulate into the discovery state.
 * @param args - Discovery arguments.
 * @param accum - Running accumulator.
 * @param field - Field to resolve.
 * @returns Updated accumulator.
 */
async function resolveAndAccumulate(
  args: IDiscoverFieldsArgs,
  accum: IFieldAccum,
  field: IFieldConfig,
): Promise<IFieldAccum> {
  const resolved = await resolveOneField({
    mediator: args.mediator,
    field,
    activeFrame: args.activeFrame,
    page: args.page,
    logger: args.logger,
  });
  const key = field.credentialKey as LoginFieldKey;
  accumulateTarget({ targets: accum.targets, key, target: resolved }, args.logger);
  if (!resolved) return accum;
  if (accum.formAnchor.has) return accum;
  const anchor = await discoverFormFromField(args, field);
  return { targets: accum.targets, formAnchor: anchor };
}

/**
 * Discover all login fields via mediator and build ILoginFieldDiscovery.
 * Password resolves first (universal anchor), then others scope from it.
 * @param args - Bundled discovery arguments.
 * @returns Fully populated login field discovery.
 */
async function executeDiscoverFields(args: IDiscoverFieldsArgs): Promise<ILoginFieldDiscovery> {
  const ordered = passwordFirst(args.config.fields);
  const seed: IFieldAccum = { targets: new Map(), formAnchor: none() };
  const seedPromise = Promise.resolve(seed);
  const final = await ordered.reduce(
    (acc, field) => acc.then(a => resolveAndAccumulate(args, a, field)),
    seedPromise,
  );
  const fallbackFrameId = computeContextId(args.activeFrame, args.page);
  const passwordTarget = final.targets.get('password' as LoginFieldKey);
  const activeFrameId = passwordTarget?.contextId ?? fallbackFrameId;
  const submitTarget = await resolveSubmitTarget(args, final.formAnchor, activeFrameId);
  return { targets: final.targets, formAnchor: final.formAnchor, activeFrameId, submitTarget };
}

/**
 * Discover form anchor from the first successfully resolved field.
 * @param args - Discovery arguments.
 * @param field - The field that was just resolved.
 * @returns Option wrapping the form anchor.
 */
async function discoverFormFromField(
  args: IDiscoverFieldsArgs,
  field: IFieldConfig,
): Promise<Option<IFormAnchor>> {
  const fieldCtx = await args.mediator.resolveField(
    field.credentialKey,
    field.selectors,
    args.activeFrame,
  );
  if (!fieldCtx.success) return none();
  return args.mediator.discoverForm(fieldCtx.value);
}

/**
 * Normalize submit config to flat array of SelectorCandidate.
 * @param submit - Single or array of candidates.
 * @returns Flat array of candidates.
 */
function normalizeSubmitConfig(submit: ILoginConfig['submit']): readonly SelectorCandidate[] {
  if (Array.isArray(submit) && submit.length > 0) return submit;
  if (!Array.isArray(submit)) return [submit];
  return WK_LOGIN_FORM.submit as unknown as readonly SelectorCandidate[];
}

/**
 * Scope candidates to form if anchor exists, otherwise pass through.
 * @param mediator - Element mediator for scoping.
 * @param raw - Raw submit candidates.
 * @param formAnchor - Optional form anchor.
 * @returns Scoped or raw candidates.
 */
function scopeSubmitCandidates(
  mediator: IElementMediator,
  raw: readonly SelectorCandidate[],
  formAnchor: Option<IFormAnchor>,
): readonly SelectorCandidate[] {
  if (!formAnchor.has) return raw;
  return mediator.scopeToForm(raw);
}

/** Candidate value fallbacks for submit resolution. */
const SUBMIT_FALLBACKS: Record<string, string> = { true: '', false: 'submit' };

/**
 * Extract candidate value from race result.
 * @param result - Race result from resolveVisible.
 * @returns Candidate value string.
 */
function extractCandidateVal(result: IRaceResult): CandidateValue {
  if (!result.candidate) return SUBMIT_FALLBACKS.false;
  return result.candidate.value;
}

/**
 * Extract candidate kind from race result.
 * @param result - Race result from resolveVisible.
 * @returns Candidate kind string.
 */
function extractCandidateKind(result: IRaceResult): CandidateKind {
  if (!result.candidate) return 'unknown';
  return result.candidate.kind;
}

/**
 * Resolve the submit button — ONE form, ONE button.
 * Step 1: Find button[type="submit"] in the SAME frame as password (structural).
 * Step 2: If none, try WK text candidates scoped to form anchor + same frame.
 * Rejects ANY button outside the password's frame.
 * @param args - Discovery arguments.
 * @param formAnchor - Discovered form anchor.
 * @param activeFrameId - Frame where password was found — submit must be here.
 * @returns Option wrapping the resolved submit target.
 */
async function resolveSubmitTarget(
  args: IDiscoverFieldsArgs,
  formAnchor: Option<IFormAnchor>,
  activeFrameId: string,
): Promise<Option<IResolvedTarget>> {
  const structuralWk = WK_LOGIN_FORM.submitStructural as unknown as readonly SelectorCandidate[];
  const structural = await resolveInFrame(args, structuralWk, activeFrameId);
  if (structural.has) return structural;
  const raw = normalizeSubmitConfig(args.config.submit);
  const scoped = scopeSubmitCandidates(args.mediator, raw, formAnchor);
  return resolveInFrame(args, scoped, activeFrameId);
}

/**
 * Resolve a visible element strictly within a specific frame.
 * @param args - Discovery arguments.
 * @param candidates - Selector candidates to try.
 * @param requiredFrameId - The only frame where a match is accepted.
 * @returns Resolved target in the correct frame, or none.
 */
async function resolveInFrame(
  args: IDiscoverFieldsArgs,
  candidates: readonly SelectorCandidate[],
  requiredFrameId: string,
): Promise<Option<IResolvedTarget>> {
  const result = await args.mediator.resolveVisible(candidates);
  if (!result.found || !result.context) return none();
  const contextId = computeContextId(result.context, args.page);
  const candidateVal = extractCandidateVal(result);
  const kind = extractCandidateKind(result);
  if (contextId !== requiredFrameId) {
    args.logger.debug({
      field: 'submit',
      result: 'WRONG_FRAME',
      message: `"${candidateVal}" in ${contextId}, expected ${requiredFrameId}`,
    });
    return none();
  }
  args.logger.debug({
    field: 'submit',
    result: 'FOUND',
    message: `"${candidateVal}" kind=${kind} frame=${contextId}`,
  });
  const selector = buildSubmitSelector(result);
  return some({ selector, contextId, kind, candidateValue: candidateVal });
}

/**
 * Build a CSS selector from the resolved submit race result.
 * Uses the locator's internal selector if available, falls back to candidate.
 * @param result - Race result from resolveVisible.
 * @returns CSS/XPath selector string.
 */
function buildSubmitSelector(result: IRaceResult): SelectorStr {
  if (!result.candidate) return 'button[type="submit"]';
  const c = result.candidate;
  const selectorMap: Record<string, string> = {
    xpath: c.value,
    textContent: `text=${c.value}`,
    exactText: `text="${c.value}"`,
    placeholder: `[placeholder="${c.value}"]`,
    ariaLabel: `[aria-label="${c.value}"]`,
    labelText: `text=${c.value}`,
  };
  return selectorMap[c.kind] ?? c.value;
}

/**
 * PRE: Discover credential form — run checkReadiness + preAction + field discovery.
 * Sets login.activeFrame AND loginFieldDiscovery for ACTION.
 * @param config - Login config.
 * @param input - Pipeline context with browser.
 * @returns Updated context with login state and field discovery.
 */
async function executeDiscoverForm(
  config: ILoginConfig,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'LOGIN PRE: no browser');
  if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'LOGIN PRE: no mediator');
  const page = input.browser.value.page;
  const readyCheck = await runCheckReadiness(config, page);
  if (readyCheck) return readyCheck;
  const frameResult = await runPreAction(config, page);
  if (!frameResult.success) return frameResult;
  const activeFrame = frameResult.value;
  const loginState: ILoginState = { activeFrame, persistentOtpToken: none() };
  input.logger.debug({
    message: maskVisibleText(`activeFrame=${activeFrame.url()}`),
  });
  const discovery = await executeDiscoverFields({
    mediator: input.mediator.value,
    config,
    activeFrame,
    page,
    logger: input.logger,
  });
  return succeed({
    ...input,
    login: some(loginState),
    loginFieldDiscovery: some(discovery),
  });
}

/**
 * ACTION: Fill fields from PRE discovery + submit via sealed executor.
 * Pure IActionContext — no bridge cast, no mediator, no raw Page.
 * @param config - Login config with submit candidates.
 * @param input - Sealed action context with discovery + executor.
 * @returns Updated context with submitMethod in diagnostics.
 */
async function executeFillAndSubmitFromDiscovery(
  config: ILoginConfig,
  input: IActionContext,
): Promise<Procedure<IActionContext>> {
  if (!input.loginAreaReady) return fail(ScraperErrorTypes.Generic, 'LOGIN ACTION: not ready');
  if (!input.loginFieldDiscovery.has) {
    return fail(ScraperErrorTypes.Generic, 'LOGIN ACTION: no field discovery');
  }
  if (!input.executor.has) return fail(ScraperErrorTypes.Generic, 'LOGIN ACTION: no executor');
  const creds = input.credentials as Record<string, string>;
  const result = await fillFromDiscovery({
    discovery: input.loginFieldDiscovery.value,
    executor: input.executor.value,
    config,
    creds,
    logger: input.logger,
  });
  if (!result.success) return result;
  const diag = { ...input.diagnostics, submitMethod: result.value.method };
  return succeed({ ...input, diagnostics: diag });
}

/** Minimal error-scan result shape for the all-frames helper. */
interface IFramesScanResult {
  readonly hasErrors: boolean;
  readonly summary: string;
}

/** Empty scan sentinel for the all-frames helper. */
const FRAMES_NO_ERRORS: IFramesScanResult = { hasErrors: false, summary: '' };

/**
 * Per-frame wall-clock budget for discoverErrors. Frames that do not
 * resolve within this budget (detached, cross-origin loading, stuck
 * script) are treated as clean so the Promise.all fan-out does not
 * block the entire login validation indefinitely.
 *
 * 3000ms matches the typical per-frame DOM scan latency on the slowest
 * SPA banks (cal-online, max) plus a 2x safety margin.
 */
const PER_FRAME_SCAN_TIMEOUT_MS = 3000;

/**
 * Produce a Promise that resolves to FRAMES_NO_ERRORS after ms elapses.
 * @param ms - Budget in milliseconds.
 * @returns Empty-scan Promise.
 */
async function budgetFrameScan(ms: number): Promise<IFramesScanResult> {
  const { setTimeout: setTimeoutPromise } = await import('node:timers/promises');
  await setTimeoutPromise(ms, undefined, { ref: false });
  return FRAMES_NO_ERRORS;
}

/**
 * Scan a single frame, swallowing detached-frame errors AND capping the
 * call at PER_FRAME_SCAN_TIMEOUT_MS so one hung frame cannot stall the
 * Promise.all fan-out across the whole frame tree.
 * @param mediator - Element mediator.
 * @param frame - Page or iframe to scan.
 * @returns Scan result (empty on failure or timeout).
 */
async function safeScanFrame(
  mediator: IElementMediator,
  frame: Page | Frame,
): Promise<IFramesScanResult> {
  const discover = mediator.discoverErrors(frame).catch((): IFramesScanResult => FRAMES_NO_ERRORS);
  const budget = budgetFrameScan(PER_FRAME_SCAN_TIMEOUT_MS);
  const scan = await Promise.race([discover, budget]);
  if (!scan.hasErrors) return FRAMES_NO_ERRORS;
  return { hasErrors: true, summary: scan.summary };
}

/**
 * Scan the main page AND every child iframe for error markers in
 * parallel. Banks like VisaCal render their login form inside a deep
 * iframe tree, so the activeFrame-only scan misses their mat-error
 * banners. Returns the first frame's error scan that has errors, or
 * FRAMES_NO_ERRORS.
 * @param mediator - Element mediator (exposes discoverErrors).
 * @param page - Playwright page.
 * @returns Scan result — first frame with errors wins.
 */
async function discoverErrorsAllFrames(
  mediator: IElementMediator,
  page: Page,
): Promise<IFramesScanResult> {
  const childFrames = page.frames();
  const frames: readonly (Page | Frame)[] = [page, ...childFrames];
  const scanPromises = frames.map(
    (frame): Promise<IFramesScanResult> => safeScanFrame(mediator, frame),
  );
  const scans = await Promise.all(scanPromises);
  const hit = scans.find((scan): HasScanErrors => scan.hasErrors);
  return hit ?? FRAMES_NO_ERRORS;
}

/**
 * POST: Validate login — check for form errors, wait for SPA traffic.
 * @param config - Login config with postAction callback.
 * @param mediator - Element mediator.
 * @param input - Pipeline context with login state + browser.
 * @returns Succeed or fail with error type.
 */
async function executeValidateLogin(
  config: ILoginConfig,
  mediator: IElementMediator,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.login.has) return fail(ScraperErrorTypes.Generic, 'LOGIN POST: no login state');
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'LOGIN POST: no browser');
  const page = input.browser.value.page;
  const activeFrame = input.login.value.activeFrame;
  const loadingDone = await mediator.waitForLoadingDone(activeFrame);
  if (!loadingDone.success) return loadingDone;
  // Scan the main frame only — iframes on SPA banks (cal-online stack)
  // carry stale pre-submit validation placeholders that produce false
  // positives against valid credentials. Invalid-creds detection for
  // SPA banks falls through to detectLoginBounce below (URL pathname
  // stays on the login path after a rejected submit).
  const errors = await safeScanFrame(mediator, page);
  if (errors.hasErrors) {
    return fail(ScraperErrorTypes.InvalidPassword, `Form: ${errors.summary}`);
  }
  await takeScreenshot(input, 'login-post-before-traffic');
  await waitForPostLoginTraffic(mediator, input.logger);
  const cbResult = await runPostCallback(page, config, input);
  if (!cbResult.success) return cbResult;
  await takeScreenshot(input, 'login-post-after-callback');
  await ensureDashboardRedirect(mediator, input);
  await takeScreenshot(input, 'login-post-after-redirect');
  const asyncCheck = await detectAsyncLoginErrors(mediator, input);
  if (asyncCheck !== false) return asyncCheck;
  const bounce = detectLoginBounce(mediator, input);
  if (bounce !== false) return bounce;
  return succeed(input);
}

/**
 * Re-scan the MAIN page for error banners that render asynchronously
 * AFTER the SPA finishes its post-submit redirect cycle (e.g. Discount's
 * "תהליך הזיהוי נכשל" banner). Iframes are deliberately excluded here
 * because SPA login iframes routinely carry stale pre-submit validation
 * placeholders (e.g. VisaCal's "שכחת להקליד" mat-errors on empty
 * fields) that fire false positives against valid-credential flows.
 * The initial (sync) scan at the top of executeValidateLogin still
 * covers iframes for invalid-creds detection.
 * @param mediator - Element mediator (for currentUrl + discoverErrors).
 * @param input - Pipeline context with browser + diagnostics.
 * @returns Failure procedure on detected async error, else false.
 */
async function detectAsyncLoginErrors(
  mediator: IElementMediator,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext> | false> {
  if (!hasStayedOnLoginUrl(mediator, input)) return false;
  if (!input.browser.has) return false;
  const page = input.browser.value.page;
  const asyncErrors = await safeScanFrame(mediator, page);
  if (!asyncErrors.hasErrors) return false;
  return fail(ScraperErrorTypes.InvalidPassword, `Form: ${asyncErrors.summary}`);
}

/**
 * Return true when the browser is still sitting on the original login
 * URL (no redirect happened). Used to decide whether the second
 * all-frames error scan is authoritative — after a successful
 * redirect, stale iframe validation placeholders would fire false
 * positives.
 * @param mediator - Element mediator (for currentUrl).
 * @param input - Pipeline context (for diagnostics.loginUrl).
 * @returns True when URL has not moved off the login path.
 */
function hasStayedOnLoginUrl(mediator: IElementMediator, input: IPipelineContext): HasScanErrors {
  const loginUrl = input.diagnostics.loginUrl;
  if (loginUrl.length === 0) return true;
  const currentUrl = mediator.getCurrentUrl();
  if (currentUrl === loginUrl) return true;
  if (currentUrl === `${loginUrl}#`) return true;
  const loginPath = loginPathOf(loginUrl);
  const currentPath = loginPathOf(currentUrl);
  return loginPath === currentPath;
}

/**
 * Normalise a URL to its pathname for path-equality comparison.
 * Returns the raw string on parse failure so the comparison still succeeds
 * when the current URL equals the login URL verbatim.
 * @param url - URL string.
 * @returns Pathname (no trailing slash unless root).
 */
/**
 * Parse a URL without throwing — returns false on malformed input.
 * @param url - URL string.
 * @returns Parsed URL or false.
 */
function safeParse(url: string): URL | false {
  try {
    return new URL(url);
  } catch {
    return false;
  }
}

/**
 * Extract the pathname of a URL, stripped of trailing slashes.
 * Falls back to the raw string when the URL cannot be parsed.
 * @param url - URL string.
 * @returns Pathname (no trailing slash unless root).
 */
function loginPathOf(url: string): LoginPathname {
  const parsed = safeParse(url);
  if (parsed === false) return url;
  const stripped = parsed.pathname.replace(/\/+$/, '');
  if (stripped.length > 0) return stripped;
  return '/';
}

/**
 * Detect when the post-submit URL landed back on the login path with a
 * MATERIALLY different URL — server bounced us (Max → `/login?ReturnURL=…`).
 * Skips when the URL is unchanged (Amex SPA login keeps the same href).
 * @param mediator - Element mediator for current URL.
 * @param input - Pipeline context (for diagnostics.loginUrl).
 * @returns Failure procedure on bounce, else false.
 */
function detectLoginBounce(
  mediator: IElementMediator,
  input: IPipelineContext,
): Procedure<IPipelineContext> | false {
  const loginUrl = input.diagnostics.loginUrl;
  if (loginUrl.length === 0) return false;
  const currentUrl = mediator.getCurrentUrl();
  if (currentUrl === loginUrl) return false;
  if (currentUrl === `${loginUrl}#`) return false;
  const loginPath = loginPathOf(loginUrl);
  const currentPath = loginPathOf(currentUrl);
  if (loginPath !== currentPath) return false;
  const masked = maskVisibleText(currentUrl);
  input.logger.debug({
    message: `POST: login bounce detected — still on ${loginPath} (url=${masked})`,
  });
  return fail(
    ScraperErrorTypes.InvalidPassword,
    `LOGIN POST: bounced back to login path ${loginPath}`,
  );
}

/**
 * Wait for post-login redirect to the authenticated dashboard.
 * After iframe login, the parent page auto-redirects. Just wait for it.
 * @param mediator - Element mediator for URL access.
 * @param input - Pipeline context with browser + diagnostics.
 * @returns True after redirect completes or timeout.
 */
async function ensureDashboardRedirect(
  mediator: IElementMediator,
  input: IPipelineContext,
): Promise<true> {
  const currentUrl = mediator.getCurrentUrl();
  const loginUrl = input.diagnostics.loginUrl;
  const isStillOnLogin = currentUrl === loginUrl || currentUrl === `${loginUrl}#`;
  if (!isStillOnLogin) return true;
  if (!input.browser.has) return true;
  input.logger.debug({
    message: 'POST: waiting for dashboard redirect',
  });
  const page = input.browser.value.page;
  const loginHash = `${currentUrl}#`;
  await page
    .waitForURL((url: URL): IsRedirect => url.href !== currentUrl && url.href !== loginHash, {
      timeout: REDIRECT_SETTLE_MS,
    })
    .catch((): false => false);
  const urlAfterWait = mediator.getCurrentUrl();
  input.logger.debug({
    message: `POST redirect → ${maskVisibleText(urlAfterWait)}`,
  });
  return true;
}

export { executeLoginSignal } from '../Auth/LoginSignalProbe.js';
export { executeDiscoverForm, executeFillAndSubmitFromDiscovery, executeValidateLogin };
// Internal helpers exposed only for focused unit tests. Do NOT import
// outside of src/Tests/Unit/**. Safe to change without deprecation.
export {
  collectIframeSnapshots,
  detectAsyncLoginErrors,
  discoverErrorsAllFrames,
  dumpFixtureHtml,
  hasStayedOnLoginUrl,
  safeScanFrame,
  writeFrameHtml,
  writeIframeSnapshot,
};
