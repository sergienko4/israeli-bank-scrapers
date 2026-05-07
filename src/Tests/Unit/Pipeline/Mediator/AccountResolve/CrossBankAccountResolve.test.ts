/**
 * Phase 7d — cross-bank FAKE-trace coverage for ACCOUNT-RESOLVE.POST.
 *
 * <p>Each fixture under `Fixtures/CrossBank/` encodes ONE bank's
 * response shape with FAKE identifiers. The driver wraps the
 * fixture's `captures` array as a pre-nav pool, runs the POST
 * handler, and asserts the resolved id count + container shape
 * match the fixture's `_fixture` envelope. Drift between the
 * extractor and any bank's real shape would surface here BEFORE
 * burning live E2E cycles.
 *
 * <p>Trap fixtures (Amex/Isracard) carry TWO captures: a partial
 * `directDebitList` followed by the full `cardList`. The picker
 * MUST score the full list higher (max-cardinality scoring); a
 * regression to first-match would resolve only the partial.
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

/** Bank id enum — closed list of pipeline browser banks today. */
type FixtureBank =
  | 'discount'
  | 'max'
  | 'hapoalim'
  | 'visacal'
  | 'amex'
  | 'isracard'
  | 'beinleumi';

/** Fixture envelope schema — Phase 7d cross-bank coverage. */
interface IFixtureEnvelope {
  readonly _fixture: {
    readonly bank: FixtureBank;
    readonly shape: string;
    readonly expectedIds: number;
    readonly expectedContainers: readonly string[];
  };
  readonly captures: readonly {
    readonly url: string;
    readonly method: 'GET' | 'POST';
    readonly captureIndex: number;
    readonly responseBody: unknown;
  }[];
}

/** Loaded fixture record. */
interface ILoadedFixture {
  readonly name: string;
  readonly envelope: IFixtureEnvelope;
}

const HERE_URL = fileURLToPath(import.meta.url);
const HERE = path.dirname(HERE_URL);
const FIXTURE_DIR = path.join(HERE, 'Fixtures', 'CrossBank');

/**
 * Synchronously load every fixture file in the cross-bank
 * directory. Sync IO is intentional — keeps the describe.each
 * table populated before the test framework hydrates.
 * @returns Loaded fixtures.
 */
function loadAllFixtures(): readonly ILoadedFixture[] {
  const allFiles = fs.readdirSync(FIXTURE_DIR);
  const jsonFiles = allFiles.filter((f): boolean => f.endsWith('.json'));
  return jsonFiles.map((name): ILoadedFixture => {
    const fullPath = path.join(FIXTURE_DIR, name);
    const raw = fs.readFileSync(fullPath, 'utf-8');
    const parsed = JSON.parse(raw) as IFixtureEnvelope;
    return { name, envelope: parsed };
  });
}

/**
 * Wraps a fixture's `captures` array as the pre-nav pool exposed
 * by the mediator. Synthesises the `IDiscoveredEndpoint` shape
 * with only the fields the POST handler reads.
 * @param envelope - Loaded fixture.
 * @returns Stub mediator.
 */
function makeFixtureMediator(envelope: IFixtureEnvelope): IElementMediator {
  const captures: readonly IDiscoveredEndpoint[] = envelope.captures.map(
    (c): IDiscoveredEndpoint => ({
      url: c.url,
      method: c.method,
      postData: '',
      responseBody: c.responseBody,
      contentType: 'application/json',
      requestHeaders: {},
      responseHeaders: {},
      timestamp: 100,
      captureIndex: c.captureIndex,
    }),
  );
  return {
    network: {
      /**
       * Returns the synthesised pool.
       * @returns Pre-nav captures.
       */
      getPreNavCaptures: (): readonly IDiscoveredEndpoint[] => captures,
    },
  } as unknown as IElementMediator;
}

/**
 * Sort container keys via locale-compare for stable expectations.
 * @param keys - Raw key list.
 * @returns Sorted key list.
 */
function localeSorted(keys: readonly string[]): readonly string[] {
  const copy = [...keys];
  return copy.sort((a, b): number => a.localeCompare(b));
}

const ALL_FIXTURES = loadAllFixtures();

/** Closed enum — keep in sync with builder-bound browser banks. */
const REQUIRED_BANKS: readonly FixtureBank[] = [
  'discount',
  'max',
  'hapoalim',
  'visacal',
  'amex',
  'isracard',
  'beinleumi',
];

describe('Phase 7d — cross-bank FAKE-trace coverage', () => {
  it('every required browser bank ships at least one fixture (F10 guard)', () => {
    const allBanks = ALL_FIXTURES.map((f): FixtureBank => f.envelope._fixture.bank);
    const banks = new Set(allBanks);
    for (const bank of REQUIRED_BANKS) {
      const isPresent = banks.has(bank);
      expect(isPresent).toBe(true);
    }
  });

  describe.each(ALL_FIXTURES)('$name', ({ envelope }) => {
    it('fixture envelope has bank + expectedIds + expectedContainers', () => {
      expect(envelope._fixture.bank).toBeTruthy();
      const idsType = typeof envelope._fixture.expectedIds;
      expect(idsType).toBe('number');
      const isExpectedContainersArray = Array.isArray(envelope._fixture.expectedContainers);
      expect(isExpectedContainersArray).toBe(true);
    });

    it('ACCOUNT-RESOLVE.POST resolves exactly the expected ids count', async () => {
      const baseCtx = makeMockContext();
      const mediatorStub = makeFixtureMediator(envelope);
      const ctx: IPipelineContext = {
        ...baseCtx,
        mediator: { has: true, value: mediatorStub },
      };
      const result = await executeAccountResolvePost(ctx);
      const wasOk = isOk(result);
      expect(wasOk).toBe(true);
      if (isOk(result) && result.value.accountDiscovery.has) {
        const ids = result.value.accountDiscovery.value.ids;
        expect(ids.length).toBe(envelope._fixture.expectedIds);
      }
    });

    it('ACCOUNT-RESOLVE.POST surfaces exactly the expected container shape', async () => {
      const baseCtx = makeMockContext();
      const mediatorStub = makeFixtureMediator(envelope);
      const ctx: IPipelineContext = {
        ...baseCtx,
        mediator: { has: true, value: mediatorStub },
      };
      const result = await executeAccountResolvePost(ctx);
      const wasOk = isOk(result);
      expect(wasOk).toBe(true);
      if (isOk(result) && result.value.accountDiscovery.has) {
        const containerKeys = Object.keys(result.value.accountDiscovery.value.containers);
        const sortedKeys = localeSorted(containerKeys);
        const sortedExpected = localeSorted(envelope._fixture.expectedContainers);
        expect(sortedKeys).toEqual(sortedExpected);
      }
    });
  });
});
