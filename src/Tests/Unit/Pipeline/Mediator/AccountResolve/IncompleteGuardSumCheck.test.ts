/**
 * Phase 7d — proves the tightened ACCOUNT_RESOLUTION_INCOMPLETE
 * fail-loud guard. The check now compares the resolved id count
 * against the SUM of all WK containers in the picked endpoint's
 * body (not the legacy single-container max), so a payload that
 * carries `cards: [4]` AND `bankAccounts: [3]` demands 7 ids.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { executeAccountResolvePost } from '../../../../../Scrapers/Pipeline/Mediator/AccountResolve/AccountResolveActions.js';
import type { IElementMediator } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

const HERE_URL = fileURLToPath(import.meta.url);
const HERE = path.dirname(HERE_URL);
const FIXTURE_DIR = path.join(HERE, 'Fixtures');

/**
 * Load a fixture JSON synchronously. Sync IO is fine for test
 * setup — keeps the helper plain and avoids beforeAll plumbing.
 * @param name - Fixture file name.
 * @returns Parsed JSON.
 */
function loadFixture(name: string): Record<string, unknown> {
  const fullPath = path.join(FIXTURE_DIR, name);
  const raw = fs.readFileSync(fullPath, 'utf-8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return parsed;
}

const GOOD_TRACE = loadFixture('visacal-account-init-good.json');
const BAD_EMPTY_CARDS = loadFixture('visacal-account-init-bad-empty-cards.json');
const BAD_MISSING_BANK = loadFixture('visacal-account-init-bad-missing-bankaccounts.json');
const BAD_NO_CONTAINERS = loadFixture('visacal-account-init-bad-no-containers.json');

/**
 * Synthesize a captured POST endpoint that carries the supplied
 * fixture body. Phase 7d tests treat the fixture as a single
 * pre-nav capture so the picker resolves it deterministically.
 * @param body - Fixture JSON.
 * @param captureIndex - Diagnostic index.
 * @returns Discovered endpoint stub.
 */
function makeFixtureCapture(body: unknown, captureIndex: number): IDiscoveredEndpoint {
  return {
    url: 'https://api.cal-online.example/Authentication/api/account/init',
    method: 'POST',
    postData: '{}',
    responseBody: body,
    contentType: 'application/json',
    requestHeaders: {},
    responseHeaders: {},
    timestamp: 100,
    captureIndex,
  };
}

/**
 * Wraps a capture pool into the minimal mediator stub the POST
 * handler reads (`network.getPreNavCaptures`).
 * @param captures - Pool to expose.
 * @returns Stub IElementMediator.
 */
function makePoolMediator(captures: readonly IDiscoveredEndpoint[]): IElementMediator {
  return {
    network: {
      /**
       * Returns the configured pool.
       * @returns Pre-nav captures.
       */
      getPreNavCaptures: (): readonly IDiscoveredEndpoint[] => captures,
    },
  } as unknown as IElementMediator;
}

/**
 * Builds a pipeline context whose mediator exposes the supplied
 * single fixture capture.
 * @param body - Fixture JSON.
 * @returns Pipeline context with the single-capture pool.
 */
function makeCtxWithFixture(body: unknown): IPipelineContext {
  const baseCtx = makeMockContext();
  const capture = makeFixtureCapture(body, 25);
  const captures: readonly IDiscoveredEndpoint[] = [capture];
  const mediatorStub = makePoolMediator(captures);
  return {
    ...baseCtx,
    mediator: { has: true, value: mediatorStub },
  };
}

/**
 * Sort container keys via locale-compare for stable expectations.
 * @param containers - Per-WK container map.
 * @returns Sorted container names.
 */
function sortedKeys(
  containers: Readonly<Record<string, readonly unknown[]>>,
): readonly string[] {
  const keys = Object.keys(containers);
  return keys.sort((a, b): number => a.localeCompare(b));
}

describe('ACCOUNT-RESOLVE.POST — Phase 7d sum-based incomplete guard', () => {
  it('GOOD VisaCal: commits 7 ids across 2 containers (cards:4 + bankAccounts:3)', async () => {
    const ctx = makeCtxWithFixture(GOOD_TRACE);
    const result = await executeAccountResolvePost(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    if (isOk(result) && result.value.accountDiscovery.has) {
      const ad = result.value.accountDiscovery.value;
      expect(ad.ids.length).toBe(7);
      expect(ad.records.length).toBe(7);
      const observedKeys = sortedKeys(ad.containers);
      expect(observedKeys).toEqual(['bankAccounts', 'cards']);
      expect(ad.containers.cards.length).toBe(4);
      expect(ad.containers.bankAccounts.length).toBe(3);
      expect(ad.endpointCaptureIndex).toBe(25);
    }
  });

  it('BAD #1 (missing bankAccounts): single container present → passes with 4 ids', async () => {
    const ctx = makeCtxWithFixture(BAD_MISSING_BANK);
    const result = await executeAccountResolvePost(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    if (isOk(result) && result.value.accountDiscovery.has) {
      const ad = result.value.accountDiscovery.value;
      expect(ad.ids.length).toBe(4);
      const observedKeys = Object.keys(ad.containers);
      expect(observedKeys).toEqual(['cards']);
    }
  });

  it('BAD #2 (empty cards): only bankAccounts surfaces → passes with 3 ids', async () => {
    const ctx = makeCtxWithFixture(BAD_EMPTY_CARDS);
    const result = await executeAccountResolvePost(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    if (isOk(result) && result.value.accountDiscovery.has) {
      const ad = result.value.accountDiscovery.value;
      expect(ad.ids.length).toBe(3);
      const observedKeys = Object.keys(ad.containers);
      expect(observedKeys).toEqual(['bankAccounts']);
    }
  });

  it('BAD #3 (no containers, no root array): F1 fails with ACCOUNT_RESOLUTION_FAILED', async () => {
    const ctx = makeCtxWithFixture(BAD_NO_CONTAINERS);
    const result = await executeAccountResolvePost(ctx);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('ACCOUNT_RESOLUTION_FAILED');
    }
  });
});

describe('ACCOUNT-RESOLVE.POST — picker prefers the largest-sum capture', () => {
  it('chooses 7-record account/init over a 1-card stub even when stub appears first', async () => {
    const goodCapture = makeFixtureCapture(GOOD_TRACE, 1);
    const stubBody = {
      result: {
        cards: [{ cardUniqueId: 'FAKE-LO-1' }],
      },
    };
    const stubCapture = makeFixtureCapture(stubBody, 2);
    const baseCtx = makeMockContext();
    const captures: readonly IDiscoveredEndpoint[] = [stubCapture, goodCapture];
    const mediatorStub = makePoolMediator(captures);
    const ctx: IPipelineContext = {
      ...baseCtx,
      mediator: { has: true, value: mediatorStub },
    };
    const result = await executeAccountResolvePost(ctx);
    expect(result.success).toBe(true);
    if (isOk(result) && result.value.accountDiscovery.has) {
      expect(result.value.accountDiscovery.value.ids.length).toBe(7);
    }
  });
});
