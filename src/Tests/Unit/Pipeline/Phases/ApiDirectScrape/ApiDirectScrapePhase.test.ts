/**
 * Unit tests for the ApiDirectScrape phase. Commit A landing test
 * — covers only the scaffold-failure path (the phase MUST return
 * a Generic failure until Commit B fills in the real body). Full
 * PRE/ACTION/POST/FINAL coverage lands in Commit B.
 */

import { runApiDirectScrapePhase } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapePhase.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';

describe('ApiDirectScrapePhase (scaffold)', () => {
  it('ADS-SCAFFOLD-1 — returns Generic failure (not yet implemented)', async () => {
    const ctx = {} as IActionContext;
    const result = await runApiDirectScrapePhase(ctx);
    expect(result.success).toBe(false);
  });
});
