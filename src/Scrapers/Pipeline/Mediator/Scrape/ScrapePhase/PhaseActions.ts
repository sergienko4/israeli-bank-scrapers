/**
 * SCRAPE phase Mediator actions — composer sub-module (Phase 8.5b C5).
 *
 * Hoists the five executeXxx phase composers out of
 * {@link ../ScrapePhaseActions.ts} so the parent collapses to a
 * pure re-export shim and every composer fits ≤10 effective LoC.
 *
 *   PRE:    executeForensicPre  → maybeForensicPrime + buildPreDiag + executeDirectDiscovery
 *   ACTION: executeMatrixLoop   → executeFrozenDirectScrape (sealed)
 *   POST:   executeValidateResults — audit + empty-gate + zero-amount warnings
 *   FINAL:  executeStampAccounts   — stamp identities + balance template
 */

import { some } from '../../../Types/Option.js';
import { type IActionContext, type IPipelineContext } from '../../../Types/PipelineContext.js';
import { type Procedure, succeed } from '../../../Types/Procedure.js';
import { logForensicAudit } from '../ForensicAuditAction.js';
import { executeFrozenDirectScrape } from '../FrozenScrapeAction.js';
import { buildTemplateForScrape } from './BalanceTemplate.js';
import { buildPreDiag, maybeForensicPrime } from './Diag.js';
import { executeDirectDiscovery } from './DirectActions.js';
import { decideEmptyGate, warnZeroAmounts } from './EmptyDetection.js';
import { buildIdentitiesForScrape } from './Identity.js';

type IScrapeStateValue = Extract<IPipelineContext['scrape'], { has: true }>['value'];

/** Bundled args for {@link buildStampedScrape}. */
interface IStampedScrapeArgs {
  readonly input: IPipelineContext;
  readonly diag: IPipelineContext['diagnostics'];
  readonly scrape: IScrapeStateValue;
}

/**
 * PRE: Forensic priming + DIRECT discovery. After .ashx removal there
 * is exactly one strategy — DIRECT.
 *
 * @param input - Pipeline context.
 * @returns Updated context with diagnostics + scrapeDiscovery.
 */
async function executeForensicPre(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  await maybeForensicPrime(input);
  const diag = buildPreDiag(input);
  return executeDirectDiscovery(input, diag);
}

/**
 * ACTION (sealed): Frozen matrix loop — uses scrapeDiscovery + api only.
 *
 * @param input - Sealed action context.
 * @returns Updated context with scraped accounts.
 */
async function executeMatrixLoop(input: IActionContext): Promise<Procedure<IActionContext>> {
  return executeFrozenDirectScrape(input);
}

/**
 * Count the scraped accounts on the context.
 *
 * @param input - Pipeline context.
 * @returns Count, zero when scrape is absent.
 */
function countScrapedAccounts(input: IPipelineContext): number {
  return (input.scrape.has && input.scrape.value.accounts.length) || 0;
}

/**
 * Build the post-action diagnostics bag with the labelled lastAction.
 *
 * @param input - Pipeline context.
 * @param label - Diagnostic label (e.g. "scrape-post (N accounts)").
 * @returns Updated diagnostics.
 */
function buildLabeledDiag(input: IPipelineContext, label: string): IPipelineContext['diagnostics'] {
  return { ...input.diagnostics, lastAction: label };
}

/**
 * POST: Audit diagnostics — forensic audit table for qualified/pruned cards.
 *
 * <p>v4 Issue 2 fix: distinguishes a true scrape miss (no capture
 * pool, no 2xx responses) from a legitimate empty result (some
 * 2xx responses landed but every account returned 0 txns — happens
 * for fresh-issue cards or accounts with no activity in the window).
 *
 * @param input - Pipeline context after scraping.
 * @returns Updated context with post diagnostics.
 */
function executeValidateResults(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  const accountCount = countScrapedAccounts(input);
  const countStr = String(accountCount);
  if (input.scrape.has) logForensicAudit(input);
  warnZeroAmounts(input);
  const emptyDecision = decideEmptyGate(input, countStr, accountCount);
  if (emptyDecision !== false) return Promise.resolve(emptyDecision);
  const diag = buildLabeledDiag(input, `scrape-post (${countStr} accounts)`);
  const result = succeed({ ...input, diagnostics: diag });
  return Promise.resolve(result);
}

/**
 * Build the scrape state with BALANCE-RESOLVE emit fields attached
 * (identities + balance template).
 *
 * @param args - Bundled input + diagnostics.
 * @returns Updated context with emit fields on scrape state.
 */
function buildEmitScrape(args: IStampedScrapeArgs): IScrapeStateValue {
  const identities = buildIdentitiesForScrape(args.input);
  const template = buildTemplateForScrape(args.input);
  const hasIdentities = identities.size > 0;
  const hasTemplate = template.url !== '';
  return {
    ...args.scrape,
    accountIdentities: hasIdentities ? identities : undefined,
    balanceFetchTemplate: hasTemplate ? template : undefined,
  };
}

/**
 * Build the IPipelineContext with stamped scrape state (emit fields attached).
 *
 * @param args - Bundled input + diagnostics + scrape state.
 * @returns Updated pipeline context.
 */
function buildStampedScrape(args: IStampedScrapeArgs): IPipelineContext {
  const emitScrape = buildEmitScrape(args);
  const scrape = some(emitScrape);
  return { ...args.input, diagnostics: args.diag, scrape };
}

/**
 * SCRAPE.post (v6) — stamp account count + emit BALANCE-RESOLVE
 * inputs onto scrape state.
 *
 * <p>Emits {@link IAccountIdentity} triples per iter accountId
 * (from accountDiscovery) and the {@link IBalanceFetchTemplate}
 * derived from the captured pool. BALANCE-RESOLVE.pre will
 * consume both and plan per-bank-account fetches.
 *
 * @param input - Pipeline context with scrape state.
 * @returns Updated context with diagnostics + identities + template.
 */
function executeStampAccounts(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  const count = countScrapedAccounts(input);
  const diag = buildLabeledDiag(input, `scrape-final (${String(count)} accounts)`);
  if (!input.scrape.has) {
    const noScrapeNext = succeed({ ...input, diagnostics: diag });
    return Promise.resolve(noScrapeNext);
  }
  const stamped = buildStampedScrape({ input, diag, scrape: input.scrape.value });
  const next = succeed(stamped);
  return Promise.resolve(next);
}

export { executeForensicPre, executeMatrixLoop, executeStampAccounts, executeValidateResults };
