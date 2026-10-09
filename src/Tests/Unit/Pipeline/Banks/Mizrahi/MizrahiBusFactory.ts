/**
 * Shared Mizrahi hard-model test factory — the committed response loader, a
 * mock mediator whose `apiPost` a spec serves, and the real generic headless
 * scrape driven over a pinned window.
 *
 * <p>Extracted so the shape suite, the simulated multi-account session and
 * the committed-fixture contract test share one definition instead of cloning
 * it (`CLAUDE.md`: factories over duplication).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { jest } from '@jest/globals';

import { MIZRAHI_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/Mizrahi/scrape/MizrahiShape.js';
import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import { buildGenericHeadlessScrape } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapeActions.js';
import type { ApiBody } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IActionContext,
  IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { resolveFixtureRoot } from '../../../../Integration/Helpers/FixturePage.js';
import { makeMockContext, makeRecoverySessionStubs } from '../../Infrastructure/MockFactories.js';

const FIXTURE_ROOT = resolveFixtureRoot('mizrahi');
const RESPONSES_DIR = path.join(FIXTURE_ROOT, 'responses');

/** Serves one apiPost dispatch: the dispatched URL and body to a reply. */
type ServePost = (url: string, body: unknown) => Procedure<unknown>;

/** The scrape window: the requested start and the pinned end. */
interface IScrapeWindow {
  readonly start: Date;
  readonly end: Date;
}

/** What the generic headless scrape resolves to. */
type MizrahiScrapeRun = ReturnType<ReturnType<typeof buildGenericHeadlessScrape>>;

/**
 * Read one committed Mode B response body.
 * @param name - Response file name (without `.json`).
 * @returns Parsed response body.
 */
export function loadMizrahiResponse(name: string): ApiBody {
  const file = path.join(RESPONSES_DIR, `${name}.json`);
  const text = fs.readFileSync(file, 'utf8');
  return JSON.parse(text) as ApiBody;
}

/**
 * Mediator whose apiPost the spec serves.
 * @param serve - Reply for one dispatch.
 * @returns Mock mediator.
 */
export function makeServedBus(serve: ServePost): IApiMediator {
  const apiPost = jest.fn(async (url: string, body: unknown): Promise<Procedure<unknown>> => {
    await Promise.resolve();
    return serve(url, body);
  });
  return {
    apiPost,
    apiGet: jest.fn(),
    apiQuery: jest.fn(),
    setBearer: jest.fn(),
    setRawAuth: jest.fn(),
    setSessionContext: jest.fn((): boolean => true),
    ...makeRecoverySessionStubs(),
    getSessionContext: jest.fn((): Readonly<Record<string, unknown>> => ({})),
  } as unknown as IApiMediator;
}

/**
 * Action context carrying the bus and the pinned window (`windowEnd` lives
 * on IActionContext).
 * @param bus - Mock mediator.
 * @param window - Requested start and pinned end.
 * @returns Action context.
 */
function ctxOf(bus: IApiMediator, window: IScrapeWindow): IActionContext {
  const base = makeMockContext();
  const options = { ...base.options, startDate: window.start };
  const withBus: IPipelineContext = { ...base, options, apiMediator: some(bus) };
  return { ...withBus, windowEnd: some(window.end) } as unknown as IActionContext;
}

/**
 * Drive MIZRAHI_SHAPE through the generic headless scrape.
 * @param bus - Mock mediator.
 * @param window - Requested start and pinned end.
 * @returns Scrape procedure.
 */
export function scrapeOver(bus: IApiMediator, window: IScrapeWindow): MizrahiScrapeRun {
  const ctx = ctxOf(bus, window);
  const scrape = buildGenericHeadlessScrape(MIZRAHI_SHAPE);
  return scrape(ctx);
}

export type { MizrahiScrapeRun, ServePost };
