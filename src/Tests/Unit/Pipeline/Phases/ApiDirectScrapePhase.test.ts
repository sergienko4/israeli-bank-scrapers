/**
 * ApiDirectScrapePhase — .final balance emission coverage.
 *
 * <p>The phase emits ctx.balanceResolution directly from the API-direct
 * shape's per-account balances so PipelineResult reads the shape-provided
 * balances. This file pins both branches of the absent-scrape guard.
 */

import { buildApiDirectScrapePhase } from '../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapePhase.js';
import type { IApiDirectScrapeShape } from '../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { none, some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { assertHas, assertOk } from '../../../Helpers/AssertProcedure.js';
import { makeMockContext } from '../Infrastructure/MockFactories.js';

/** The phase's FINAL stage never invokes the shape's scrape action, so a stub shape is enough. */
const PHASE = buildApiDirectScrapePhase({} as IApiDirectScrapeShape<unknown, unknown>);

describe('ApiDirectScrapePhase — v6 .final balanceResolution emission', () => {
  it('FINAL: emits balanceResolution from scrape.accounts when scrape is present', async () => {
    const phase = PHASE;
    const ctx = makeMockContext({
      scrape: some({
        accounts: [
          { accountNumber: 'ACC-1', balance: 150, txns: [] },
          { accountNumber: 'ACC-2', balance: 0, txns: [] },
        ],
      }),
    });
    const result = await phase.final(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess && result.value.balanceResolution.has) {
      const map = result.value.balanceResolution.value;
      const acc1 = map.get('ACC-1');
      const acc2 = map.get('ACC-2');
      expect(acc1).toBe(150);
      expect(acc2).toBe(0);
    }
  });

  it('FINAL: passes input through unchanged when scrape is absent', async () => {
    const phase = PHASE;
    const ctx = makeMockContext({ scrape: none() });
    const result = await phase.final(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) {
      expect(result.value.balanceResolution.has).toBe(false);
    }
  });

  it('FINAL: missing balance is OMITTED from the resolution map (default-deny)', async () => {
    const phase = PHASE;
    const ctx = makeMockContext({
      scrape: some({
        accounts: [{ accountNumber: 'ACC-NULL', txns: [] }],
      }),
    });
    const result = await phase.final(ctx, ctx);
    assertOk(result);
    assertHas(result.value.balanceResolution);
    const map = result.value.balanceResolution.value;
    const hasEntry = map.has('ACC-NULL');
    expect(hasEntry).toBe(false);
  });
});
