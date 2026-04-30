/**
 * Unit tests for PostLoginTrafficProbe — wait for organic SPA traffic.
 */

import waitForPostLoginTraffic from '../../../../../Scrapers/Pipeline/Mediator/Auth/PostLoginTrafficProbe.js';
import type { IElementMediator } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import type { ScraperLogger } from '../../../../../Scrapers/Pipeline/Types/Debug.js';

/** Script for mediator behaviour. */
interface IScript {
  readonly trafficHit?: IDiscoveredEndpoint | false;
  readonly currentUrl?: string;
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
       * waitForTraffic — returns scripted endpoint or false.
       * @returns Scripted.
       */
      waitForTraffic: (): Promise<IDiscoveredEndpoint | false> =>
        Promise.resolve(script.trafficHit ?? false),
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
    const hit: IDiscoveredEndpoint = {
      url: 'https://bank.co.il/api/transactions',
      method: 'GET',
      postData: '',
      contentType: 'application/json',
      requestHeaders: {},
      responseHeaders: {},
      responseBody: {},
      timestamp: 0,
    };
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
    const hit: IDiscoveredEndpoint = {
      url: 'https://bank.co.il/api/accounts',
      method: 'GET',
      postData: '',
      contentType: 'application/json',
      requestHeaders: {},
      responseHeaders: {},
      responseBody: {},
      timestamp: 0,
    };
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
});
