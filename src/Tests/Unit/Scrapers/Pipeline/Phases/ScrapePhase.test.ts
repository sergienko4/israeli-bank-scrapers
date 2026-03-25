/**
 * Unit tests for ScrapePhase.ts.
 * Covers custom scrape step, config scrape step, and stub.
 */

import {
  createConfigScrapeStep,
  createCustomScrapeStep,
  createScrapePhase,
  SCRAPE_POST_STEP,
  SCRAPE_PRE_STEP,
  SCRAPE_STEP,
} from '../../../../../Scrapers/Pipeline/Phases/ScrapePhase.js';
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

// ── SCRAPE_PRE_STEP ─────────────────────────────────────

describe('SCRAPE_PRE_STEP', () => {
  it('has name "scrape-pre"', () => {
    expect(SCRAPE_PRE_STEP.name).toBe('scrape-pre');
  });

  it('sets fetchStartMs in diagnostics', async () => {
    const ctx = makeMockContext();
    const result = await SCRAPE_PRE_STEP.execute(ctx, ctx);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.diagnostics.fetchStartMs.has).toBe(true);
    }
  });
});

// ── SCRAPE_POST_STEP ────────────────────────────────────

describe('SCRAPE_POST_STEP', () => {
  it('has name "scrape-post"', () => {
    expect(SCRAPE_POST_STEP.name).toBe('scrape-post');
  });

  it('updates diagnostics with account count', async () => {
    const scrapeState = { accounts: [{ accountNumber: 'A1', txns: [] }] };
    const ctx = makeMockContext({ scrape: some(scrapeState) });
    const result = await SCRAPE_POST_STEP.execute(ctx, ctx);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.diagnostics.lastAction).toContain('1 accounts');
    }
  });

  it('handles no scrape state gracefully', async () => {
    const ctx = makeMockContext();
    const result = await SCRAPE_POST_STEP.execute(ctx, ctx);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.diagnostics.lastAction).toContain('0 accounts');
    }
  });
});

// ── createScrapePhase factory ───────────────────────────

describe('createScrapePhase', () => {
  it('returns IPhaseDefinition with pre, action, and post', () => {
    const phase = createScrapePhase();
    expect(phase.name).toBe('scrape');
    expect(phase.pre.has).toBe(true);
    expect(phase.post.has).toBe(true);
  });

  it('uses SCRAPE_STEP as default action', () => {
    const phase = createScrapePhase();
    expect(phase.action.name).toBe('scrape');
  });

  it('accepts a custom action step', () => {
    const customStep = createCustomScrapeStep(ctx => {
      const r = succeed(ctx);
      return Promise.resolve(r);
    });
    const phase = createScrapePhase(customStep);
    expect(phase.action.name).toBe('scrape');
    expect(phase.pre.has).toBe(true);
    expect(phase.post.has).toBe(true);
  });
});
