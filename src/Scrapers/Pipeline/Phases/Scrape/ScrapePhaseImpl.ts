/**
 * ScrapePhase implementation — SimplePhase with PRE/POST/FINAL overrides.
 * Extracted from ScrapePhase.ts to respect max-lines.
 */

import { scrapePostDiagnostics } from '../../Mediator/Scrape/ForensicAuditAction.js';
import type { IPipelineStep } from '../../Types/Phase.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import { SimplePhase } from '../../Types/SimplePhase.js';
import { scrapePreDiagnostics } from './ScrapeDiscoveryStep.js';

/** Result type shorthand. */
type StepResult = Promise<Procedure<IPipelineContext>>;
/** Context shorthand. */
type Ctx = IPipelineContext;

/**
 * FINAL step: stamp account count for audit trail.
 * @param input - Pipeline context with scrape state.
 * @returns Updated context with lastAction diagnostic.
 */
function scrapeFinal(input: Ctx): StepResult {
  const count = (input.scrape.has && input.scrape.value.accounts.length) || 0;
  const label = `scrape-final (${String(count)} accounts)`;
  const diag = { ...input.diagnostics, lastAction: label };
  const result = succeed({ ...input, diagnostics: diag });
  return Promise.resolve(result);
}

/** Scrape phase with PRE/POST diagnostics. */
class ScrapePhaseImpl extends SimplePhase {
  /**
   * PRE: qualification diagnostics.
   * @param ctx - Context.
   * @param input - Input.
   * @returns Updated context.
   */
  public async pre(ctx: Ctx, input: Ctx): StepResult {
    void this.name;
    return scrapePreDiagnostics(ctx, input);
  }

  /**
   * POST: audit diagnostics.
   * @param ctx - Context.
   * @param input - Input.
   * @returns Updated context.
   */
  public async post(ctx: Ctx, input: Ctx): StepResult {
    void this.name;
    return scrapePostDiagnostics(ctx, input);
  }

  /**
   * FINAL: stamp account count.
   * @param _ctx - Unused.
   * @param input - Input.
   * @returns Updated context.
   */
  public final(_ctx: Ctx, input: Ctx): StepResult {
    void this.name;
    return scrapeFinal(input);
  }
}

/**
 * Default auto-scrape execute handler.
 * @param _ctx - Unused.
 * @param input - Pipeline context with ctx.api.
 * @returns Updated context with scraped accounts.
 */
type AutoScrapeExec = IPipelineStep<Ctx, Ctx>['execute'];

/**
 * Create the SCRAPE phase with PRE/POST diagnostics.
 * @param actionExec - Custom action (default: auto-scrape).
 * @returns ScrapePhase extending SimplePhase.
 */
function createScrapePhase(actionExec: AutoScrapeExec): SimplePhase {
  return Reflect.construct(ScrapePhaseImpl, ['scrape', actionExec]) as SimplePhase;
}

export default createScrapePhase;
export { createScrapePhase };
