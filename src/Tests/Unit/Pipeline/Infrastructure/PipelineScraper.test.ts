import { jest } from '@jest/globals';

import { CompanyTypes, type ScraperProgressTypes } from '../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import type { VoidResult } from '../../../../Scrapers/Base/Interfaces/CallbackTypes.js';
import type { IPipelineDescriptor } from '../../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';
import {
  type PipelineBuildFn,
  PipelineScraper,
} from '../../../../Scrapers/Pipeline/Core/PipelineScraper.js';
import type { IActionContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockCredentials, makeMockDescriptor, makeMockOptions } from './MockFactories.js';
import { SimplePhase } from './SimplePhase.js';

const MOCK_OPTIONS = makeMockOptions({ companyId: CompanyTypes.Beinleumi });
const MOCK_CREDENTIALS = makeMockCredentials();

/**
 * Stub pipeline builder.
 * @returns Minimal pipeline descriptor.
 */
function mockBuildPipeline(): ReturnType<typeof makeMockDescriptor> {
  return makeMockDescriptor(MOCK_OPTIONS);
}

describe('PipelineScraper/scrape', () => {
  it('delegates to executePipeline and returns result', async () => {
    const scraper = new PipelineScraper(MOCK_OPTIONS, mockBuildPipeline);
    const result = await scraper.scrape(MOCK_CREDENTIALS);
    expect(result.success).toBe(true);
  });

  it('calls buildPipeline with stored options', async () => {
    const buildSpy = jest.fn(mockBuildPipeline);
    const scraper = new PipelineScraper(MOCK_OPTIONS, buildSpy);
    await scraper.scrape(MOCK_CREDENTIALS);
    expect(buildSpy).toHaveBeenCalledTimes(1);
    expect(buildSpy).toHaveBeenCalledWith(MOCK_OPTIONS);
  });

  it('returns legacy failure when buildPipeline fails', async () => {
    /**
     * Stub that always returns failure.
     * @returns Failed procedure.
     */
    const buildFailing = (): ReturnType<typeof makeMockDescriptor> =>
      fail(ScraperErrorTypes.Generic, 'build failed');
    const scraper = new PipelineScraper(MOCK_OPTIONS, buildFailing);
    const result = await scraper.scrape(MOCK_CREDENTIALS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.Generic);
  });
});

describe('PipelineScraper/onProgress', () => {
  it('registers a progress listener without throwing', () => {
    const scraper = new PipelineScraper(MOCK_OPTIONS, mockBuildPipeline);
    const callback = jest.fn() as unknown as Parameters<typeof scraper.onProgress>[0];
    /**
     * Invoke `onProgress` so `.not.toThrow()` captures the call's
     * throw-or-not contract — the test's measurable outcome.
     */
    const register = (): void => {
      scraper.onProgress(callback);
    };
    expect(register).not.toThrow();
  });
});

/** A typed spy standing in for a consumer's progress listener. */
type Listener = jest.Mock<VoidResult, [CompanyTypes, { type: ScraperProgressTypes }]>;

/** What a phase action does when the pipeline runs it. */
type ActionFn = (ctx: IActionContext, input: IActionContext) => Promise<Procedure<IActionContext>>;

/** Counts how many times a phase action ran. */
interface IRunCount {
  count: number;
}

/**
 * A listener spy typed like the public `onProgress` callback.
 * @returns The spy.
 */
function makeListener(): Listener {
  return jest.fn<VoidResult, [CompanyTypes, { type: ScraperProgressTypes }]>();
}

/**
 * An action that counts its run and then succeeds or fails.
 * @param ran - Where the run is counted.
 * @param isOk - Whether the action succeeds.
 * @returns The action.
 */
function countingAction(ran: IRunCount, isOk: boolean): ActionFn {
  /**
   * Count the run, then pass the context through or fail.
   * @param _ctx - Unused.
   * @param input - The context to pass through.
   * @returns The outcome.
   */
  const act: ActionFn = (_ctx, input) => {
    ran.count += 1;
    const failure = fail(ScraperErrorTypes.Generic, 'scrape failed');
    const outcome = isOk ? succeed(input) : failure;
    return Promise.resolve(outcome);
  };
  return act;
}

/**
 * A pipeline builder that runs one real phase.
 * @param phase - The phase to run.
 * @returns The builder.
 */
function buildWith(phase: SimplePhase): PipelineBuildFn {
  /**
   * Build a one-phase descriptor.
   * @returns The descriptor.
   */
  const build: PipelineBuildFn = () => {
    const descriptor: IPipelineDescriptor = { options: MOCK_OPTIONS, phases: [phase] };
    return succeed(descriptor);
  };
  return build;
}

/**
 * Build a scraper around one counted phase and register a listener on it.
 * @param isOk - Whether the phase succeeds.
 * @returns The scraper, its listener and the phase's run counter.
 */
function listeningScraper(isOk: boolean): {
  readonly scraper: PipelineScraper<ReturnType<typeof makeMockCredentials>>;
  readonly listener: Listener;
  readonly ran: IRunCount;
} {
  const ran: IRunCount = { count: 0 };
  const action = countingAction(ran, isOk);
  const phase = new SimplePhase('api-direct-call', action);
  const scraper = new PipelineScraper(MOCK_OPTIONS, buildWith(phase));
  const listener = makeListener();
  scraper.onProgress(listener);
  return { scraper, listener, ran };
}

/*
 * Pins today's accepted contract: `onProgress` accepts a listener, and no execution
 * ever calls it. docs/advanced-usage.md documents this difference from upstream.
 * Delivering events is a public behavior change, so these tests and that page move
 * together; a passing "registered without throwing" check alone proves nothing.
 */
describe('PipelineScraper/onProgress — accepted no-event contract', () => {
  it('[PRG-1] a successful execution delivers no event to a registered listener', async () => {
    const { scraper, listener, ran } = listeningScraper(true);
    const result = await scraper.scrape(MOCK_CREDENTIALS);
    expect(result.success).toBe(true);
    expect(ran.count).toBe(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it('[PRG-2] a failed execution delivers no event to a registered listener', async () => {
    const { scraper, listener, ran } = listeningScraper(false);
    const result = await scraper.scrape(MOCK_CREDENTIALS);
    expect(result).toMatchObject({ success: false, errorMessage: 'scrape failed' });
    expect(ran.count).toBe(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it('[PRG-3] a pipeline that cannot be built delivers no event either', async () => {
    /**
     * Stub that always returns failure.
     * @returns Failed procedure.
     */
    const buildFailing = (): ReturnType<typeof makeMockDescriptor> =>
      fail(ScraperErrorTypes.Generic, 'build failed');
    const scraper = new PipelineScraper(MOCK_OPTIONS, buildFailing);
    const listener = makeListener();
    scraper.onProgress(listener);
    const result = await scraper.scrape(MOCK_CREDENTIALS);
    expect(result.success).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('[PRG-4] every listener registered on the scraper stays silent', async () => {
    const { scraper, listener } = listeningScraper(true);
    const second = makeListener();
    scraper.onProgress(second);
    await scraper.scrape(MOCK_CREDENTIALS);
    expect(listener).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });
});
