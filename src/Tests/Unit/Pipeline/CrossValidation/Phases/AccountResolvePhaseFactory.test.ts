/**
 * Phase H.T3c.8 — cross-bank ACCOUNT-RESOLVE per-phase factory.
 *
 * <p>Drives every bank's PII-redacted accounts payload through
 * production {@link executeAccountResolvePost} +
 * {@link executeAccountResolveFinal}, asserting the slim
 * {@link IAccountDiscovery} contract commits with the captured id
 * count. Each row consumes a dedicated
 * `<bank>/account-resolve/<scenarioId>.json` fixture (locked plan
 * H.T3c.8: "+ 7 fixtures + amex/beinleumi Phase E fixture gap fill").
 *
 * <p>Contract (`AccountResolveActions.ts:249-278`):
 * <ul>
 *   <li>POST: succeeds when the pre-nav pool's accounts endpoint
 *       yields >= 1 id AND the id count matches the expected
 *       container max. Fails loud otherwise.</li>
 *   <li>FINAL: always succeeds — telemetry-only per design.</li>
 * </ul>
 *
 * <p>Per-bank `responseBody` shapes are the PII-redacted last-good
 * payload from each bank's captured run — Hapoalim's `cards`,
 * beinleumi's `bankAccountNumber` aliases, Discount's `accountIds`,
 * etc. — so `pickAccountEndpoint` + `extractAccountIds` exercise
 * the real production extraction path, not synthetic mocks.
 */

import {
  executeAccountResolveFinal,
  executeAccountResolvePost,
} from '../../../../../Scrapers/Pipeline/Mediator/AccountResolve/AccountResolveActions.js';
import { buildAccountResolvePhaseContext } from './Fixtures/_makeAccountResolvePhaseContext.js';
import { loadPhaseFixture, type PhaseHBank } from './Fixtures/_makePhaseFixture.js';

/** Per-scenario row driven by the parameterised `it.each` below. */
interface IAccountResolveScenarioRow {
  readonly bank: PhaseHBank;
  readonly scenarioId: string;
  readonly poolUrl: string;
}

/**
 * Bank-specific accounts response body shape. Each fixture stores
 * `accountsResponseBody` under `_fixture` as a free-form JSON value;
 * the factory reads it via the slim shape below.
 */
interface IAccountsFixtureMeta {
  readonly accountsResponseBody?: unknown;
}

/** Scenarios exercised — one row per bank, all using last-good captures. */
const SCENARIOS: readonly IAccountResolveScenarioRow[] = [
  {
    bank: 'hapoalim',
    scenarioId: 'last-good',
    poolUrl: 'https://login.bankhapoalim.example/ServerServices/general/accounts',
  },
  {
    bank: 'beinleumi',
    scenarioId: 'last-good',
    poolUrl: 'https://login.beinleumi.example/api/accounts',
  },
  {
    bank: 'discount',
    scenarioId: 'last-good',
    poolUrl: 'https://start.telebank.example/api/accounts',
  },
  {
    bank: 'amex',
    scenarioId: 'last-good',
    poolUrl: 'https://digital.amex.example/api/accounts',
  },
  {
    bank: 'isracard',
    scenarioId: 'last-good',
    poolUrl: 'https://digital.isracard.example/api/accounts',
  },
  {
    bank: 'max',
    scenarioId: 'last-good',
    poolUrl: 'https://www.max.example/api/accounts',
  },
  {
    bank: 'visacal',
    scenarioId: 'last-good',
    poolUrl: 'https://login.cal-online.example/api/accounts',
  },
];

describe('ACCOUNT-RESOLVE-PHASE-FACTORY — Phase H per-bank POST+FINAL', () => {
  it.each(SCENARIOS)(
    'accountResolve_$bank_$scenarioId_ShouldCommitDiscoveryFromPool',
    async (row): Promise<void> => {
      const fixture = loadPhaseFixture(row.bank, `account-resolve/${row.scenarioId}`);
      const meta = fixture.meta as unknown as IAccountsFixtureMeta & typeof fixture.meta;
      const responseBody = meta.accountsResponseBody;
      const subject = buildAccountResolvePhaseContext({
        poolUrl: row.poolUrl,
        responseBody,
      });

      const postResult = await executeAccountResolvePost(subject.context);
      const shouldPostSucceed = fixture.meta.expected.accountResolvePostOutcome === 'success';
      expect(postResult.success).toBe(shouldPostSucceed);

      if (postResult.success) {
        const finalResult = await executeAccountResolveFinal(postResult.value);
        const shouldFinalSucceed = fixture.meta.expected.accountResolveFinalOutcome === 'success';
        expect(finalResult.success).toBe(shouldFinalSucceed);
        if (finalResult.success && finalResult.value.accountDiscovery.has) {
          const expectedCount = fixture.meta.expected.accountResolveExpectedIdCount ?? 1;
          expect(finalResult.value.accountDiscovery.value.ids.length).toBe(expectedCount);
        }
      }
    },
  );
});
