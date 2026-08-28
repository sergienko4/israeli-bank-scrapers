/**
 * Sanitization Pulse — re-run interceptors and retry a failed phase.
 * Generic recovery: PopupInterceptor can dismiss late-appearing overlays.
 * Extracted from PipelineExecutor to respect max-lines.
 */

import { setActivePhase, setActiveStage } from '../../Types/ActiveState.js';
import type { PhaseName } from '../../Types/Phase.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import { isOk } from '../../Types/Procedure.js';
import { traceResult } from '../PipelineTraceService.js';
import { applyInterceptors, type IContextTracker } from './PipelineMiddleware.js';

/** Bundled phase step context for tracing. */
interface IPhaseStep {
  readonly name: PhaseName;
  readonly tag: string;
  readonly index: number;
}

/** Bundled retry context for sanitization pulse. */
interface IPulseArgs {
  readonly tracker: IContextTracker;
  readonly ctx: IPipelineContext;
  readonly step: IPhaseStep;
}

/**
 * Prime ActiveState before phase retry.
 * @param name - Phase name.
 * @param logger - Pipeline logger.
 * @returns True after priming.
 */
function primeRetry(name: PhaseName, logger: IPipelineContext['logger']): true {
  setActivePhase(name);
  setActiveStage('PRE');
  logger.debug({ message: `retry: ${name}` });
  return true;
}

/**
 * Phases granted a SECOND recovery pulse.
 *
 * <p>Clearing an obstruction and making progress past it are separate steps.
 * Max stacks a consent bar and a marketing modal: the first pulse clears the
 * modal that swallowed HOME's trigger click, and only the second sees the menu
 * that click finally opened. One pulse leaves the phase one move short.
 *
 * <p>Deliberately narrow — every other phase keeps its single retry, so the
 * pipeline-wide recovery contract is unchanged.
 */
const TWO_PULSE_PHASES: ReadonlySet<PhaseName> = new Set<PhaseName>(['home']);

/** Pulses granted to a phase listed in {@link TWO_PULSE_PHASES}. */
const TWO_PULSE_BUDGET = 2 as const;

/** Pulses every other phase keeps — the pipeline-wide single retry. */
const ONE_PULSE_BUDGET = 1 as const;

/**
 * Decides whether a reload is safe for one phase given where the page landed.
 * @param ctx - Pipeline context, for the bank's configured base URL.
 * @param currentUrl - URL the page reports itself to be on.
 * @returns True when the retry should be preceded by a reload.
 */
type ReloadGate = (ctx: IPipelineContext, currentUrl: string) => boolean;

/**
 * Gate for phases whose reload is safe wherever the page ended up.
 * @returns Always true.
 */
const ALWAYS_RELOAD: ReloadGate = (): boolean => true;

/**
 * Compare origins without throwing on the URLs a browser can genuinely report
 * — `about:blank`, `data:`, or the empty string a page has before first load.
 * @param a - First URL.
 * @param b - Second URL.
 * @returns True when both parse and share an origin.
 */
function sameOrigin(a: string, b: string): boolean {
  if (!URL.canParse(a) || !URL.canParse(b)) return false;
  return new URL(a).origin === new URL(b).origin;
}

/**
 * Gate for phases that may only reload while still on the bank's own site.
 * @param ctx - Pipeline context, for the bank's configured base URL.
 * @param currentUrl - URL the page reports itself to be on.
 * @returns True when the page is still on the bank's origin.
 */
const ONLY_ON_BANK_SITE: ReloadGate = (ctx, currentUrl): boolean =>
  sameOrigin(currentUrl, ctx.config.urls.base);

/**
 * Phases whose retry is preceded by a reload of the current document, each
 * mapped to the condition that makes the reload safe.
 *
 * <p>Re-running interceptors cannot re-bootstrap a page. When an SPA serves
 * its shell but never hydrates, PRE-LOGIN's form gate finds no password field,
 * and a retry that only re-queries the same dead document is structurally
 * guaranteed to fail — every pulse is spent on a page that could not recover.
 * Reloading first is what makes recovery possible at all. The same holds when
 * a bank's edge answers the homepage with an error document under HTTP 200:
 * INIT sees a healthy status, HOME scans an error page, and no amount of
 * re-querying will produce a login link that the document never contained.
 *
 * <p>Deliberately narrow, like {@link TWO_PULSE_PHASES}. A reload is only
 * sound before credentials exist: it is idempotent for a discovery phase, but
 * would discard a submitted form or a delivered OTP. Every phase outside this
 * map keeps its exact retry behaviour, and the budget is unchanged either way.
 *
 * <p>HOME carries a gate rather than reloading unconditionally because a pulse
 * retries the whole phase. Once HOME's ACTION has navigated to the login page,
 * reloading there would re-run home discovery against a document that never
 * had a home login link — converting a recoverable failure into a certain one.
 * The check is by origin, not exact URL, so a canonicalising redirect such as
 * `/` to `/he/` still counts as being on the bank's site.
 */
const RELOAD_BEFORE_RETRY_PHASES: ReadonlyMap<PhaseName, ReloadGate> = new Map<
  PhaseName,
  ReloadGate
>([
  ['pre-login', ALWAYS_RELOAD],
  ['home', ONLY_ON_BANK_SITE],
]);

/**
 * Budget for the pre-retry reload. Sized for a full document load rather than
 * a probe, since the point is to let a stalled SPA bootstrap.
 */
const RELOAD_TIMEOUT_MS = 30_000;

/**
 * Reload the current document so a phase listed in
 * {@link RELOAD_BEFORE_RETRY_PHASES} retries against a fresh mount.
 *
 * <p>Best-effort: `navigateTo` reports failure rather than throwing, and a
 * failed reload simply leaves the retry to run exactly as it did before. The
 * URL is read back from the page rather than rebuilt from config, so a bank
 * that redirected during the phase reloads where it actually is — and so the
 * gate judges where the page really landed rather than where it was sent.
 * @param args - Bundled pulse arguments.
 * @returns True when a reload was attempted, false when the phase opts out.
 */
async function reloadBeforeRetry(args: IPulseArgs): Promise<boolean> {
  const { ctx, step } = args;
  const gate = RELOAD_BEFORE_RETRY_PHASES.get(step.name);
  if (!gate || !ctx.mediator.has) return false;
  const mediator = ctx.mediator.value;
  const url = mediator.getCurrentUrl();
  if (!gate(ctx, url)) return false;
  ctx.logger.debug({ message: `sanitization-pulse: reload before ${step.name}` });
  await mediator.navigateTo(url, { waitUntil: 'domcontentloaded', timeout: RELOAD_TIMEOUT_MS });
  return true;
}

/**
 * Recovery pulses a failed phase may consume.
 * @param name - Phase that failed.
 * @returns Pulse budget for that phase.
 */
function pulseBudget(name: PhaseName): number {
  return TWO_PULSE_PHASES.has(name) ? TWO_PULSE_BUDGET : ONE_PULSE_BUDGET;
}

/**
 * Record which pulse is about to run and how many the phase may spend.
 * @param args - Bundled pulse arguments.
 * @param attempt - 1-based pulse number.
 * @returns True once the line is written.
 */
function logPulse(args: IPulseArgs, attempt: number): boolean {
  const { ctx, step } = args;
  const budget = pulseBudget(step.name);
  const nth = `${String(attempt)}/${String(budget)}`;
  ctx.logger.debug({ message: `sanitization-pulse: ${step.name} (${nth})` });
  return true;
}

/**
 * Run interceptors once, then retry the failed phase once.
 * @param args - Bundled pulse arguments.
 * @param attempt - 1-based pulse number, surfaced in the log so a trace shows
 *   which pulse cleared the obstruction and how many were consumed.
 * @returns Recovered context, or false when this attempt did not recover.
 */
async function pulseOnce(args: IPulseArgs, attempt: number): Promise<IPipelineContext | false> {
  const { tracker, ctx, step } = args;
  logPulse(args, attempt);
  await reloadBeforeRetry(args);
  const pulsed = await applyInterceptors(tracker, ctx, step.name);
  if (!isOk(pulsed)) return false;
  primeRetry(step.name, ctx.logger);
  const retry = await tracker.phases[step.index].run(pulsed.value);
  return isOk(retry) ? retry.value : false;
}

/**
 * Pulse until the phase recovers or the budget runs out.
 * @param args - Bundled pulse arguments.
 * @param attempt - 1-based pulse number to run next.
 * @returns Recovered context, or false when every pulse failed.
 */
async function pulseFrom(args: IPulseArgs, attempt: number): Promise<IPipelineContext | false> {
  if (attempt > pulseBudget(args.step.name)) return false;
  const recovered = await pulseOnce(args, attempt);
  if (recovered !== false) return recovered;
  return pulseFrom(args, attempt + 1);
}

/**
 * Sanitization Pulse: re-run interceptors then retry the failed phase, within
 * the phase's {@link pulseBudget}.
 * @param args - Bundled pulse arguments.
 * @returns Recovered context or false if every retry also failed.
 */
async function sanitizationPulse(args: IPulseArgs): Promise<IPipelineContext | false> {
  const recovered = await pulseFrom(args, 1);
  if (recovered === false) return false;
  const { logger } = args.ctx;
  traceResult({ logger, name: args.step.name, indexTag: args.step.tag, isSuccess: true });
  return recovered;
}

export type { IPhaseStep };
export { sanitizationPulse };
