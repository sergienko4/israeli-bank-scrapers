/**
 * Unit tests for ScrapePhase.ts.
 * Covers custom scrape step, config scrape step, and stub.
 */

import {
  createConfigScrapeStep,
  createCustomScrapeStep,
  SCRAPE_STEP,
} from '../../../../../Scrapers/Pipeline/Phases/Scrape/ScrapePhase.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import { succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeContextWithBrowser,
  makeMockContext,
  makeMockFetchStrategy,
  makeMockScrapeConfig,
} from '../MockPipelineFactories.js';

// ── SCRAPE_STEP stub ──────────────────────────────────────

describe('SCRAPE_STEP/stub', () => {
  it('has name "scrape"', () => {
    expect(SCRAPE_STEP.name).toBe('scrape');
  });

  it('returns succeed(input) without modifying context', async () => {
    const ctx = makeMockContext();
    const result = await SCRAPE_STEP.execute(ctx, ctx);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toBe(ctx);
  });
});

// ── createCustomScrapeStep ────────────────────────────────

describe('createCustomScrapeStep', () => {
  it('calls the provided scrape function with input context', async () => {
    const called: unknown[] = [];
    const ctx = makeMockContext();
    const step = createCustomScrapeStep(input => {
      called.push(input);
      const result = succeed(input);
      return Promise.resolve(result);
    });
    await step.execute(ctx, ctx);
    expect(called).toHaveLength(1);
    expect(called[0]).toBe(ctx);
  });

  it('returns the result from the custom function', async () => {
    const ctx = makeMockContext();
    const step = createCustomScrapeStep(input => {
      const scrapeState = { accounts: [] };
      const scrapeSome = some(scrapeState);
      const updated = { ...input, scrape: scrapeSome };
      const result = succeed(updated);
      return Promise.resolve(result);
    });
    const result = await step.execute(ctx, ctx);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.scrape.has).toBe(true);
  });

  it('step name is "scrape"', () => {
    const step = createCustomScrapeStep(ctx => {
      const r = succeed(ctx);
      return Promise.resolve(r);
    });
    expect(step.name).toBe('scrape');
  });
});

// ── createConfigScrapeStep ────────────────────────────────

describe('createConfigScrapeStep', () => {
  it('step name is "scrape"', () => {
    const config = makeMockScrapeConfig();
    const step = createConfigScrapeStep(config);
    expect(step.name).toBe('scrape');
  });

  it('calls executeScrape and returns populated scrape state', async () => {
    const config = makeMockScrapeConfig();
    const ctx = makeContextWithBrowser();
    const fetchStrategy = makeMockFetchStrategy();
    const fetchSome = some(fetchStrategy);
    const ctxWithFetch = { ...ctx, fetchStrategy: fetchSome };
    const step = createConfigScrapeStep(config);
    const result = await step.execute(ctxWithFetch, ctxWithFetch);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.scrape.has).toBe(true);
  });

  it('fails when fetchStrategy is absent', async () => {
    const config = makeMockScrapeConfig();
    const ctx = makeMockContext();
    const step = createConfigScrapeStep(config);
    const result = await step.execute(ctx, ctx);
    expect(result.success).toBe(false);
  });
});
