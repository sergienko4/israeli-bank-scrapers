/**
 * Phase prelude-override parametric test — one row per phase that
 * opted into the page-readiness gate.
 *
 * <p>Each phase declares which stages need a prelude via the protected
 * `prelude(stage)` hook on {@link BasePhase}. This test pins:
 * <ul>
 *   <li>Opted-in stages return the expected `{ level, timeoutMs }` shape.</li>
 *   <li>Non-opted stages return `PRELUDE_NONE`.</li>
 *   <li>The wait budget matches the per-phase TimingConfig constant.</li>
 * </ul>
 *
 * <p>Single audit point: if a future commit accidentally removes an
 * opt-in or drifts the budget, exactly one row in this file fails.
 */

import type { ILoginConfig } from '../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import type { IPreludeSpec } from '../../../../Scrapers/Pipeline/Mediator/Elements/PagePrelude.js';
import { PRELUDE_NONE } from '../../../../Scrapers/Pipeline/Mediator/Elements/PagePrelude.js';
import {
  DASHBOARD_PRELUDE_TIMEOUT_MS,
  HOME_PRELUDE_TIMEOUT_MS,
  LOGIN_PRELUDE_POST_TIMEOUT_MS,
  OTP_FILL_PRELUDE_TIMEOUT_MS,
  OTP_TRIGGER_PRELUDE_TIMEOUT_MS,
} from '../../../../Scrapers/Pipeline/Mediator/Timing/TimingConfig.js';
import { createDashboardPhase } from '../../../../Scrapers/Pipeline/Phases/Dashboard/DashboardPhase.js';
import { createHomePhase } from '../../../../Scrapers/Pipeline/Phases/Home/HomePhase.js';
import { createLoginPhaseFromConfig } from '../../../../Scrapers/Pipeline/Phases/Login/LoginPhase.js';
import { createOtpFillPhase } from '../../../../Scrapers/Pipeline/Phases/OtpFill/OtpFillPhase.js';
import { createOtpTriggerPhase } from '../../../../Scrapers/Pipeline/Phases/OtpTrigger/OtpTriggerPhase.js';
import type { BasePhase } from '../../../../Scrapers/Pipeline/Types/BasePhase.js';

const STUB_LOGIN_CONFIG = {} as unknown as ILoginConfig;

/** Stage labels the hook receives. */
type StageLabel = 'PRE' | 'ACTION' | 'POST' | 'FINAL';

/**
 * Test bridge — invoke a phase's protected `prelude(stage)` from outside
 * the class for parametric assertion. Casting through a structural type
 * is safer than `any` and keeps the call site `as unknown` free.
 */
interface IPreludeProbe {
  readonly prelude: (stage: StageLabel) => IPreludeSpec;
}

/**
 * Bridge the protected `prelude(stage)` method out for assertion in
 * the parametric matrix below.
 *
 * @param phase - The phase instance under test.
 * @param stage - The stage label to query.
 * @returns The phase's declared prelude spec for that stage.
 */
function preludeOf(phase: BasePhase, stage: StageLabel): IPreludeSpec {
  return (phase as unknown as IPreludeProbe).prelude(stage);
}

/** Row describing a phase + its expected opt-in matrix. */
interface IPhaseOptInRow {
  readonly label: string;
  readonly buildPhase: () => BasePhase;
  readonly optedIn: ReadonlyMap<StageLabel, IPreludeSpec>;
}

const ROWS: readonly IPhaseOptInRow[] = [
  {
    label: 'HOME',
    buildPhase: createHomePhase,
    optedIn: new Map<StageLabel, IPreludeSpec>([
      ['PRE', { level: 'spa', timeoutMs: HOME_PRELUDE_TIMEOUT_MS }],
      ['ACTION', { level: 'spa', timeoutMs: HOME_PRELUDE_TIMEOUT_MS }],
    ]),
  },
  {
    label: 'OTP-TRIGGER',
    buildPhase: createOtpTriggerPhase,
    optedIn: new Map<StageLabel, IPreludeSpec>([
      ['PRE', { level: 'dom', timeoutMs: OTP_TRIGGER_PRELUDE_TIMEOUT_MS }],
      ['ACTION', { level: 'dom', timeoutMs: OTP_TRIGGER_PRELUDE_TIMEOUT_MS }],
    ]),
  },
  {
    label: 'OTP-FILL',
    /**
     * Construct an OTP-Fill phase with default `required=true` so the
     * BasePhase prelude override is exercised.
     *
     * @returns Fresh OtpFillPhase instance.
     */
    buildPhase: (): BasePhase => createOtpFillPhase(),
    optedIn: new Map<StageLabel, IPreludeSpec>([
      ['PRE', { level: 'dom', timeoutMs: OTP_FILL_PRELUDE_TIMEOUT_MS }],
    ]),
  },
  {
    label: 'DASHBOARD',
    buildPhase: createDashboardPhase,
    optedIn: new Map<StageLabel, IPreludeSpec>([
      ['PRE', { level: 'spa', timeoutMs: DASHBOARD_PRELUDE_TIMEOUT_MS }],
      ['ACTION', { level: 'spa', timeoutMs: DASHBOARD_PRELUDE_TIMEOUT_MS }],
    ]),
  },
  {
    label: 'LOGIN',
    /**
     * Construct a LOGIN phase with a stub config — the test only reads
     * the prelude override which does not consult any login-config field.
     *
     * @returns Fresh LoginPhase instance.
     */
    buildPhase: (): BasePhase => createLoginPhaseFromConfig(STUB_LOGIN_CONFIG),
    optedIn: new Map<StageLabel, IPreludeSpec>([
      ['POST', { level: 'spa', timeoutMs: LOGIN_PRELUDE_POST_TIMEOUT_MS }],
    ]),
  },
];

const ALL_STAGES: readonly StageLabel[] = ['PRE', 'ACTION', 'POST', 'FINAL'];

describe('Phase prelude opt-in matrix (per-phase override on BasePhase)', () => {
  describe.each(ROWS)('$label', (row): void => {
    const phase = row.buildPhase();
    ALL_STAGES.forEach((stage): void => {
      const expected = row.optedIn.get(stage) ?? PRELUDE_NONE;
      const label = JSON.stringify(expected);
      it(`returns ${label} for ${stage}`, () => {
        const actual = preludeOf(phase, stage);
        expect(actual).toEqual(expected);
      });
    });
  });
});
