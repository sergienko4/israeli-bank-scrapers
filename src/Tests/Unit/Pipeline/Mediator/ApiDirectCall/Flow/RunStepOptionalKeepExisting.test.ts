/**
 * Keep-existing optional extracts. A `keepExisting` slot is written only
 * while carry holds no non-empty string for it; a different answer value is
 * noted on the debug log by step and slot, never by value. Without the flag a
 * present value still overwrites.
 */

import { jest } from '@jest/globals';

import type { IStepConfig } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import type {
  CarryMap,
  JsonValue,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.types.js';

/** Logger shared by the module under test and the assertions. */
const LOG = {
  trace: jest.fn(),
  debug: jest.fn<boolean, [unknown]>(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

jest.unstable_mockModule('../../../../../../Scrapers/Pipeline/Logging/Debug.js', async () => ({
  ...(await import('../../../../../../Scrapers/Pipeline/Logging/BankContext.js')),
  /**
   * Every module derives its logger from `import.meta.url`.
   * @returns The shared mock logger.
   */
  getDebug: (): typeof LOG => LOG,
  /**
   * Legacy entry point, present so the mock covers the module's surface.
   * @returns The shared mock logger.
   */
  getDebugByName: (): typeof LOG => LOG,
}));

const OPTIONAL =
  await import('../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.optional.js');

const STEP: IStepConfig = {
  name: 'login',
  urlTag: 'auth.login',
  body: { shape: {} },
  extractsToCarry: {},
  optionalExtractsToCarry: {
    did: { pointer: '/did', keepExisting: true },
    sid: { pointer: '/sid' },
  },
};

/** One answer, the carry before it, and the addition the step must make. */
interface IKeepCase {
  readonly label: string;
  readonly prior: CarryMap;
  readonly resp: JsonValue;
  readonly expected: CarryMap;
}

const CASES: readonly IKeepCase[] = [
  {
    label: 'writes a keep-existing slot while carry has none',
    prior: {},
    resp: { did: 'syn-did-2', sid: 'syn-sid-2' },
    expected: { did: 'syn-did-2', sid: 'syn-sid-2' },
  },
  {
    label: 'writes a keep-existing slot while carry holds an empty string',
    prior: { did: '' },
    resp: { did: 'syn-did-2' },
    expected: { did: 'syn-did-2' },
  },
  {
    label: 'keeps a held slot and still overwrites a slot without the flag',
    prior: { did: 'syn-did-1', sid: 'syn-sid-1' },
    resp: { did: 'syn-did-2', sid: 'syn-sid-2' },
    expected: { sid: 'syn-sid-2' },
  },
  {
    label: 'keeps a held slot when the answer echoes it',
    prior: { did: 'syn-did-1' },
    resp: { did: 'syn-did-1' },
    expected: {},
  },
];

/**
 * Read the debug entries that note a kept slot.
 * @returns The logged `kept` entries.
 */
function keptEntries(): readonly unknown[] {
  const calls = LOG.debug.mock.calls.map((call): unknown => call[0]);
  return calls.filter((entry): boolean => JSON.stringify(entry).includes('"kept"'));
}

beforeEach((): void => {
  LOG.debug.mockClear();
});

describe('keep-existing optional extracts', () => {
  it.each(CASES)('$label', (row): void => {
    const addition = OPTIONAL.extractOptional(row.resp, STEP, row.prior);
    expect(addition).toEqual(row.expected);
  });

  it('logs a kept slot by step and slot only when the answer differs', (): void => {
    OPTIONAL.extractOptional({ did: 'syn-did-2' }, STEP, { did: 'syn-did-1' });
    const logged = keptEntries();
    expect(logged).toEqual([expect.objectContaining({ step: 'login', slot: 'did', kept: true })]);
    const text = JSON.stringify(logged);
    expect(text).not.toContain('syn-did');
  });

  it('logs nothing when the held slot is echoed back', (): void => {
    OPTIONAL.extractOptional({ did: 'syn-did-1' }, STEP, { did: 'syn-did-1' });
    const logged = keptEntries();
    expect(logged).toEqual([]);
  });
});
