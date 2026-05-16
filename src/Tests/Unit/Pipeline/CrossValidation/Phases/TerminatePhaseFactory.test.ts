/**
 * Phase H.T3c.10 — cross-bank TERMINATE per-phase factory.
 *
 * <p>Drives every PHASE_H_BANK through production
 * {@link executeStartCleanup} (PRE) + {@link executeLogResults}
 * (POST helper) + {@link executeSignalDone} (FINAL), asserting all
 * three sub-steps succeed per design. Each row consumes a dedicated
 * `<bank>/terminate/<scenarioId>.json` fixture (locked plan
 * H.T3c.10: "+ 7 fixtures").
 *
 * <p>Contract (`TerminateActions.ts`): all sub-steps always succeed
 * by design — TERMINATE swallows cleanup errors so the pipeline can
 * finish even when teardown encounters resource failures. The
 * cross-bank value here is the wiring regression mode (did a bank's
 * builder accidentally drop TERMINATE from its phase sequence?).
 */

import {
  executeLogResults,
  executeSignalDone,
  executeStartCleanup,
} from '../../../../../Scrapers/Pipeline/Mediator/Terminate/TerminateActions.js';
import { loadPhaseFixture, type PhaseHBank } from './Fixtures/_makePhaseFixture.js';
import { buildTerminatePhaseContext } from './Fixtures/_makeTerminatePhaseContext.js';

/** Per-scenario row driven by the parameterised `it.each` below. */
interface ITerminateScenarioRow {
  readonly bank: PhaseHBank;
  readonly scenarioId: string;
}

/** Scenarios exercised — one row per bank. */
const SCENARIOS: readonly ITerminateScenarioRow[] = [
  { bank: 'hapoalim', scenarioId: 'last-good' },
  { bank: 'beinleumi', scenarioId: 'last-good' },
  { bank: 'discount', scenarioId: 'last-good' },
  { bank: 'amex', scenarioId: 'last-good' },
  { bank: 'isracard', scenarioId: 'last-good' },
  { bank: 'max', scenarioId: 'last-good' },
  { bank: 'visacal', scenarioId: 'last-good' },
];

describe('TERMINATE-PHASE-FACTORY — Phase H per-bank PRE+POST+FINAL', () => {
  it.each(SCENARIOS)(
    'terminate_$bank_$scenarioId_ShouldSucceedAtEverySubStep',
    async (row): Promise<void> => {
      const fixture = loadPhaseFixture(row.bank, `terminate/${row.scenarioId}`);
      const subject = buildTerminatePhaseContext();
      const shouldSucceed = fixture.meta.expected.terminateOutcome === 'success';

      const preResult = await executeStartCleanup(subject.context);
      expect(preResult.success).toBe(shouldSucceed);
      if (preResult.success) {
        const postResult = await executeLogResults(preResult.value);
        expect(postResult.success).toBe(shouldSucceed);
        if (postResult.success) {
          const finalResult = await executeSignalDone(postResult.value);
          expect(finalResult.success).toBe(shouldSucceed);
        }
      }
    },
  );
});
