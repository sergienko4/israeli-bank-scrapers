/**
 * E13 — a warm token must look like a token before it is replayed.
 *
 * A seed with a control character, a non-ASCII character or more than
 * `MAX_ACCESS_TOKEN_CHARS` characters is dropped with a warning that names the
 * field but never the value, so the cold login runs instead.
 */

import { jest } from '@jest/globals';

/** Logger shared by the module under test and the assertions. */
const LOG = {
  trace: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

jest.unstable_mockModule('../../../../../../Scrapers/Pipeline/Logging/Debug.js', async () => ({
  ...(await import('../../../../../../Scrapers/Pipeline/Types/MockTiming.js')),
  ...(await import('../../../../../../Scrapers/Pipeline/Logging/BankContext.js')),
  /**
   * The module derives its logger from `import.meta.url`.
   * @returns The shared mock logger.
   */
  getDebug: (): typeof LOG => LOG,
  /**
   * Legacy entry point, present so the mock covers the module's surface.
   * @returns The shared mock logger.
   */
  getDebugByName: (): typeof LOG => LOG,
}));

const SHARED =
  await import('../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/TokenStrategyFromConfig.shared.js');
const RULES =
  await import('../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/PersistentAuthStateRules.js');

type CallConfig = Parameters<typeof SHARED.pickWarmSeed>[0];

const CONFIG: CallConfig = {
  flow: 'sms-otp',
  steps: [],
  envelope: {},
  warmStart: { credsField: 'otpLongTermToken', carryField: 'token', fromStepIndex: 1 },
};

/** Every seed carries this marker, so a leaked value is easy to spot. */
const MARKER = 'syn-';
const LONGEST = MARKER + 'a'.repeat(RULES.MAX_ACCESS_TOKEN_CHARS - MARKER.length);

/** One stored seed and whether the warm path may replay it. */
interface ISeedCase {
  readonly label: string;
  readonly seed: string;
  readonly isKept: boolean;
}

const CASES: readonly ISeedCase[] = [
  { label: 'a printable token', seed: 'syn-udid:syn-key', isKept: true },
  { label: 'a token at the length cap', seed: LONGEST, isKept: true },
  { label: 'a token over the length cap', seed: `${LONGEST}a`, isKept: false },
  { label: 'a token with CR/LF', seed: 'syn-key\r\nX-Injected: 1', isKept: false },
  { label: 'a token with a tab', seed: 'syn\tkey', isKept: false },
  { label: 'a token with a non-ASCII character', seed: 'syn-kéy', isKept: false },
];

beforeEach((): void => {
  LOG.warn.mockClear();
});

describe('E13 warm token shape', () => {
  it.each(CASES)('$label → kept=$isKept', (row): void => {
    const picked = SHARED.pickWarmSeed(CONFIG, { otpLongTermToken: row.seed });
    const expected = row.isKept && row.seed;
    expect(picked).toBe(expected);
    const warnCount = Number(!row.isKept);
    expect(LOG.warn).toHaveBeenCalledTimes(warnCount);
    const logged = JSON.stringify(LOG.warn.mock.calls);
    expect(logged).not.toContain(MARKER);
  });

  it('starts cold without a warning when no token is stored', (): void => {
    const picked = SHARED.pickWarmSeed(CONFIG, {});
    expect(picked).toBe(false);
    expect(LOG.warn).not.toHaveBeenCalled();
  });
});
