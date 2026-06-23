/**
 * Unit tests for PostLoginTrafficProbe — wait for organic SPA traffic.
 */

import type { IElementMediator } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import waitForPostLoginTraffic from '../../../../../Scrapers/Pipeline/Mediator/Login/PostLoginTrafficProbe.js';
import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import { LOGIN_TRAFFIC_WAIT_TIMEOUT_MS } from '../../../../../Scrapers/Pipeline/Mediator/Timing/LoginTimingConfig.js';
import type { ScraperLogger } from '../../../../../Scrapers/Pipeline/Types/Debug.js';

/** Script for mediator behaviour. */
interface IScript {
  readonly trafficHit?: IDiscoveredEndpoint | false;
  readonly currentUrl?: string;
  /** Mutable ref — filled in by waitForTraffic stub with the received budget. */
  capturedBudget?: number;
  /** Captured response pool returned by getAllEndpoints. */
  readonly pool?: readonly IDiscoveredEndpoint[];
  /** Successful-response count returned by countSuccessfulResponses. */
  readonly successful?: number;
}

/**
 * Build a discovered endpoint with default fields.
 * @param url - Endpoint URL.
 * @returns Endpoint with the given URL.
 */
function makeEndpoint(url: string): IDiscoveredEndpoint {
  return {
    url,
    method: 'GET',
    postData: '',
    contentType: 'application/json',
    requestHeaders: {},
    responseHeaders: {},
    responseBody: {},
    timestamp: 0,
  };
}

/**
 * No-op logger method.
 * @returns True.
 */
function loggerNoop(): boolean {
  return true;
}

/**
 * Build a logger that captures debug payloads into a sink.
 * @param sink - Array to receive each debug entry.
 * @returns Mock logger.
 */
function makeCapturingLogger(sink: unknown[]): ScraperLogger {
  return {
    trace: loggerNoop,
    /**
     * Capture a debug entry.
     * @param entry - Debug payload.
     * @returns True.
     */
    debug: (entry: unknown): boolean => {
      sink.push(entry);
      return true;
    },
    info: loggerNoop,
    warn: loggerNoop,
    error: loggerNoop,
  } as unknown as ScraperLogger;
}

/**
 * Build a mediator stub.
 * @param script - Behaviour.
 * @returns Mock mediator.
 */
function makeMediator(script: IScript): IElementMediator {
  return {
    network: {
      /**
       * waitForTraffic — records budget, returns scripted endpoint or false.
       * @param _patterns - Ignored patterns.
       * @param budget - Budget ms passed by caller.
       * @returns Scripted.
       */
      waitForTraffic: (
        _patterns: unknown,
        budget: number,
      ): Promise<IDiscoveredEndpoint | false> => {
        script.capturedBudget = budget;
        return Promise.resolve(script.trafficHit ?? false);
      },
      /**
       * getAllEndpoints — returns the scripted captured pool.
       * @returns Scripted endpoints (empty when unset).
       */
      getAllEndpoints: (): readonly IDiscoveredEndpoint[] => script.pool ?? [],
      /**
       * countSuccessfulResponses — returns the scripted success count.
       * @returns Scripted count (0 when unset).
       */
      countSuccessfulResponses: (): number => script.successful ?? 0,
    },
    /**
     * getCurrentUrl.
     * @returns Scripted URL.
     */
    getCurrentUrl: (): string => script.currentUrl ?? 'https://bank.co.il/login',
  } as unknown as IElementMediator;
}

describe('waitForPostLoginTraffic', () => {
  it('returns true when transaction traffic detected', async () => {
    const hit = makeEndpoint('https://bank.co.il/api/transactions');
    const mediator = makeMediator({ trafficHit: hit });
    const hasTraffic = await waitForPostLoginTraffic(mediator);
    expect(hasTraffic).toBe(true);
  });

  it('returns false when no traffic observed', async () => {
    const mediator = makeMediator({ trafficHit: false });
    const hasTraffic = await waitForPostLoginTraffic(mediator);
    expect(hasTraffic).toBe(false);
  });

  it('accepts a logger for trace output (with traffic)', async () => {
    const traceCalls: unknown[] = [];
    const logger = {
      /**
       * Capture trace.
       * @param e - Entry.
       * @returns True.
       */
      trace: (e: unknown): boolean => {
        traceCalls.push(e);
        return true;
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      debug: (): boolean => true,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      info: (): boolean => true,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      warn: (): boolean => true,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      error: (): boolean => true,
    } as unknown as ScraperLogger;
    const hit = makeEndpoint('https://bank.co.il/api/accounts');
    const mediator = makeMediator({ trafficHit: hit });
    const hasTraffic = await waitForPostLoginTraffic(mediator, logger);
    expect(hasTraffic).toBe(true);
    expect(traceCalls.length).toBeGreaterThan(0);
  });

  it('accepts a logger for trace output (no traffic)', async () => {
    let traceCount = 0;
    const logger = {
      /**
       * Capture trace.
       * @returns True.
       */
      trace: (): boolean => {
        traceCount += 1;
        return true;
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      debug: (): boolean => true,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      info: (): boolean => true,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      warn: (): boolean => true,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      error: (): boolean => true,
    } as unknown as ScraperLogger;
    const mediator = makeMediator({ trafficHit: false });
    const hasTraffic = await waitForPostLoginTraffic(mediator, logger);
    expect(hasTraffic).toBe(false);
    expect(traceCount).toBe(1);
  });

  it('uses the default budget when budgetMs is omitted', async () => {
    const script: IScript = { trafficHit: false };
    const mediator = makeMediator(script);
    await waitForPostLoginTraffic(mediator);
    expect(script.capturedBudget).toBe(LOGIN_TRAFFIC_WAIT_TIMEOUT_MS);
  });

  it('forwards a custom budgetMs to waitForTraffic', async () => {
    const script: IScript = { trafficHit: false };
    const mediator = makeMediator(script);
    await waitForPostLoginTraffic(mediator, undefined, 99_000);
    expect(script.capturedBudget).toBe(99_000);
  });

  it('emits a PII-safe auth-confirm pool histogram to logger.debug', async () => {
    const pool = [
      makeEndpoint('https://www.americanexpress.co.il/api/IsLoggedIn'),
      makeEndpoint('https://www.americanexpress.co.il/api/GetCardList'),
      makeEndpoint('https://googleads.g.doubleclick.net/pagead/1'),
      makeEndpoint('https://googleads.g.doubleclick.net/pagead/2'),
      makeEndpoint('https://googleads.g.doubleclick.net/pagead/3'),
      makeEndpoint('not-a-url'),
    ];
    const debugCalls: unknown[] = [];
    const logger = makeCapturingLogger(debugCalls);
    const mediator = makeMediator({ trafficHit: false, pool, successful: 2 });
    await waitForPostLoginTraffic(mediator, logger);
    expect(debugCalls).toHaveLength(1);
    expect(debugCalls[0]).toMatchObject({
      event: 'login.authconfirm.pool',
      total: 6,
      successful: 2,
      hosts: {
        'www.americanexpress.co.il': 2,
        'googleads.g.doubleclick.net': 3,
        invalid: 1,
      },
      hasTraffic: false,
    });
    expect((debugCalls[0] as { elapsedMs: number }).elapsedMs).toBeGreaterThanOrEqual(0);
  });
});
