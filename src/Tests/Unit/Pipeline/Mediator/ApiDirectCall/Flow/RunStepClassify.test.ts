/**
 * N50 — the answer classifier. A step's `classify` names the shapes its opened
 * answer may take: exactly one case must match, its name goes to carry `into`
 * beside its captures, and a matched `fail` case stops the step. When no case
 * or more than one matches, the debug log gets the answer's redacted shape,
 * never a value.
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import type {
  IAnswerCapture,
  IAnswerCase,
  IAnswerCheck,
  IAnswerClassifier,
  IStepConfig,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import type {
  CarryMap,
  JsonValue,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.types.js';
import type { Procedure } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Logger shared by the module under test and the assertions. */
const LOG = {
  trace: jest.fn(),
  debug: jest.fn<boolean, [unknown]>(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

jest.unstable_mockModule('../../../../../../Scrapers/Pipeline/Logging/Debug.js', async () => ({
  ...(await import('../../../../../../Scrapers/Pipeline/Types/MockTiming.js')),
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

const CLASSIFY =
  await import('../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.classify.js');

/** A step with no classifier. */
const PLAIN_STEP: IStepConfig = {
  name: 'login',
  urlTag: 'auth.login',
  body: { shape: {} },
  extractsToCarry: {},
};

/** Expected result of a classifier whose one case `hit` matched. */
const HIT = { success: true, value: { branch: 'hit' } };

/** Expected failure when no case matches. */
const UNRECOGNIZED = {
  success: false,
  errorType: ScraperErrorTypes.Generic,
  errorMessage: 'login answer unrecognized',
};

/** Expected failure when more than one case matches. */
const AMBIGUOUS = {
  success: false,
  errorType: ScraperErrorTypes.Generic,
  errorMessage: 'login answer ambiguous',
};

/** Check that the state is pending. */
const PENDING: IAnswerCheck = { pointer: '/state', equals: 'pending' };

/**
 * Classify an answer with the given classifier.
 * @param classify - Classifier under test.
 * @param resp - Opened answer.
 * @returns The classifier's verdict.
 */
function classifyWith(classify: IAnswerClassifier, resp: JsonValue): Procedure<CarryMap> {
  const step: IStepConfig = { ...PLAIN_STEP, classify };
  return CLASSIFY.classifyAnswer(step, resp);
}

/**
 * A classifier of one case `hit` holding one check.
 * @param check - The case's only check.
 * @returns The classifier.
 */
function oneCheck(check: IAnswerCheck): IAnswerClassifier {
  return { into: 'branch', cases: [{ name: 'hit', when: [check] }] };
}

/**
 * Classify a pending answer whose `/v` holds the value, through a case that
 * writes one capture `slot`.
 * @param capture - The capture under test.
 * @param value - Value at `/v`.
 * @returns The classifier's verdict.
 */
function captureWith(capture: IAnswerCapture, value: JsonValue): Procedure<CarryMap> {
  const otp: IAnswerCase = { name: 'otp', when: [PENDING], captures: { slot: capture } };
  return classifyWith({ into: 'branch', cases: [otp] }, { state: 'pending', v: value });
}

/**
 * The expected refusal of capture `slot`.
 * @param reason - `missing` or `invalid`.
 * @returns The expected failure.
 */
function captureRefused(reason: string): Record<string, unknown> {
  const errorMessage = `login answer capture slot ${reason}`;
  return { success: false, errorType: ScraperErrorTypes.Generic, errorMessage };
}

beforeEach((): void => {
  LOG.debug.mockClear();
});

describe('classifyAnswer — no classifier', () => {
  it('passes any answer with no carry', () => {
    const verdict = CLASSIFY.classifyAnswer(PLAIN_STEP, { state: 'odd' });
    expect(verdict).toEqual({ success: true, value: {} });
  });
});

describe('classifyAnswer — check kinds', () => {
  const sms = [
    { type: 'push', id: 'c0' },
    { type: 'sms', id: 'c1' },
  ];
  const short: IAnswerCheck = { pointer: '/t', text: { maxChars: 4 } };
  const letters: IAnswerCheck = { pointer: '/t', text: { maxChars: 9, pattern: '[a-z]+' } };

  it.each<[string, IAnswerCheck, JsonValue]>([
    ['equals a string', PENDING, { state: 'pending' }],
    ['equals false', { pointer: '/b', equals: false }, { b: false }],
    ['equals null', { pointer: '/x', equals: null }, { x: null }],
    ['oneOf a listed string', { pointer: '/s', oneOf: ['gen', 'val'] }, { s: 'val' }],
    ['oneOf a listed number', { pointer: '/len', oneOf: [4, 6, 8] }, { len: 6 }],
    ['items of exactly n', { pointer: '/a', items: 1 }, { a: ['x'] }],
    ['keys of exactly n', { pointer: '/o', keys: 1 }, { o: { k: 1 } }],
    ['text within maxChars', short, { t: 'abcd' }],
    ['text matching the whole pattern', letters, { t: 'abc' }],
    ['absent when the pointer misses', { pointer: '/gone', absent: true }, { s: 'x' }],
    ['a typed array filter', { pointer: '/ch/?type=sms/id', equals: 'c1' }, { ch: sms }],
  ])('passes %s', (_label, check, resp) => {
    const classify = oneCheck(check);
    const verdict = classifyWith(classify, resp);
    expect(verdict).toEqual(HIT);
  });

  it.each<[string, IAnswerCheck, JsonValue]>([
    ['equals with another string', PENDING, { state: 'done' }],
    ['equals across types', { pointer: '/n', equals: 1 }, { n: '1' }],
    ['equals on an object', PENDING, { state: { pending: 1 } }],
    ['oneOf with an unlisted one', { pointer: '/s', oneOf: ['gen'] }, { s: 'x' }],
    ['oneOf across types', { pointer: '/len', oneOf: [6] }, { len: '6' }],
    ['items of another count', { pointer: '/a', items: 1 }, { a: ['x', 'y'] }],
    ['items on an object', { pointer: '/a', items: 1 }, { a: { k: 1 } }],
    ['keys of another count', { pointer: '/o', keys: 1 }, { o: { k: 1, j: 2 } }],
    ['keys on an array', { pointer: '/o', keys: 1 }, { o: ['k'] }],
    ['empty text', short, { t: '' }],
    ['text one char over', short, { t: 'abcde' }],
    ['text with a C0 char', short, { t: 'a\tb' }],
    ['text with DEL', short, { t: 'a\u007fb' }],
    ['a number as text', short, { t: 1234 }],
    ['text matching only part of the pattern', letters, { t: 'abc1' }],
    [
      'text whose pattern escapes the whole-match wrapper',
      { ...letters, text: { maxChars: 9, pattern: 'a)|(?:b' } },
      { t: 'ax' },
    ],
    [
      'text whose pattern does not compile',
      { ...letters, text: { maxChars: 9, pattern: '(' } },
      {
        t: 'abc',
      },
    ],
    ['absent with a value', { pointer: '/s', absent: true }, { s: 'x' }],
    ['absent with a null value', { pointer: '/s', absent: true }, { s: null }],
    ['a missing pointer', { pointer: '/gone', equals: 'x' }, { s: 'x' }],
  ])('refuses %s', (_label, check, resp) => {
    const classify = oneCheck(check);
    const verdict = classifyWith(classify, resp);
    expect(verdict).toMatchObject(UNRECOGNIZED);
  });
});

describe('classifyAnswer — pointer alternatives', () => {
  const either: readonly string[] = ['/a', '/b'];

  it.each<[string, IAnswerCheck, JsonValue]>([
    ['reads the first that resolves', { pointer: either, equals: 'x' }, { b: 'x' }],
    ['is absent when none resolves', { pointer: either, absent: true }, { c: 1 }],
  ])('%s', (_label, check, resp) => {
    const classify = oneCheck(check);
    const verdict = classifyWith(classify, resp);
    expect(verdict).toEqual(HIT);
  });

  it.each<[string, IAnswerCheck, JsonValue]>([
    ['reads no later one', { pointer: either, equals: 'x' }, { a: 'y', b: 'x' }],
    ['is not absent when any resolves', { pointer: either, absent: true }, { b: 1 }],
  ])('%s', (_label, check, resp) => {
    const classify = oneCheck(check);
    const verdict = classifyWith(classify, resp);
    expect(verdict).toMatchObject(UNRECOGNIZED);
  });
});

describe('classifyAnswer — exactly one case', () => {
  const noFormat: IAnswerCase = { name: 'otp', when: [{ pointer: '/fmt', absent: true }] };
  const numeric: IAnswerCase = { name: 'otp', when: [{ pointer: '/fmt/type', equals: 'numeric' }] };
  const anyText: IAnswerCase = {
    name: 'other',
    when: [{ pointer: '/fmt', text: { maxChars: 9 } }],
  };

  it.each<[string, JsonValue]>([
    ['the first variant', { state: 'pending' }],
    ['the second variant', { fmt: { type: 'numeric' } }],
  ])('writes a repeated name through %s', (_label, resp) => {
    const verdict = classifyWith({ into: 'branch', cases: [noFormat, numeric] }, resp);
    expect(verdict).toEqual({ success: true, value: { branch: 'otp' } });
  });

  it('fails when no case matches', () => {
    const verdict = classifyWith({ into: 'branch', cases: [noFormat, numeric] }, { fmt: 'qr' });
    expect(verdict).toMatchObject(UNRECOGNIZED);
  });

  it('fails when two cases match', () => {
    const listed: IAnswerCase = { name: 'listed', when: [{ pointer: '/fmt', oneOf: ['x'] }] };
    const verdict = classifyWith({ into: 'branch', cases: [listed, anyText] }, { fmt: 'x' });
    expect(verdict).toMatchObject(AMBIGUOUS);
  });

  it('fails when one case is listed twice', () => {
    const verdict = classifyWith({ into: 'branch', cases: [anyText, anyText] }, { fmt: 'x' });
    expect(verdict).toMatchObject(AMBIGUOUS);
  });

  it('fails when two cases of one name match', () => {
    const loose: IAnswerCase = { name: 'otp', when: [{ pointer: '/fmt', keys: 1 }] };
    const resp = { fmt: { type: 'numeric' } };
    const verdict = classifyWith({ into: 'branch', cases: [numeric, loose] }, resp);
    expect(verdict).toMatchObject(AMBIGUOUS);
  });

  it('needs every check of a case to pass', () => {
    const both: IAnswerCase = { name: 'hit', when: [PENDING, { pointer: '/n', equals: 1 }] };
    const verdict = classifyWith({ into: 'branch', cases: [both] }, { state: 'pending', n: 2 });
    expect(verdict).toMatchObject(UNRECOGNIZED);
  });
});

describe('classifyAnswer — fail cases', () => {
  const locked: IAnswerCase = {
    name: 'locked',
    when: [{ pointer: '/locked', equals: true }],
    fail: ScraperErrorTypes.AccountBlocked,
    captures: { id: { pointer: '/id', maxChars: 9 } },
  };
  const open: IAnswerCase = { name: 'password', when: [{ pointer: '/locked', equals: false }] };
  const classify: IAnswerClassifier = { into: 'branch', cases: [open, locked] };

  it('stops with the matched case type', () => {
    const verdict = classifyWith(classify, { locked: true, id: 'syn-id' });
    const errorMessage = 'login answer locked';
    expect(verdict).toMatchObject({ success: false, errorType: locked.fail, errorMessage });
  });

  it('passes when another case matches', () => {
    const verdict = classifyWith(classify, { locked: false });
    expect(verdict).toEqual({ success: true, value: { branch: 'password' } });
  });
});

describe('classifyAnswer — captures', () => {
  const text: IAnswerCapture = { pointer: '/v', maxChars: 3 };
  const onlyKey: IAnswerCapture = { pointer: '/v', maxChars: 5, onlyKey: true };
  const integer: IAnswerCapture = { pointer: '/v', maxChars: 2, integer: { min: 4, max: 10 } };

  it.each<[string, IAnswerCapture, { value: JsonValue; slot: string }]>([
    ['text', text, { value: 'abc', slot: 'abc' }],
    ['the only key', onlyKey, { value: { 'tgt-1': { kind: 'sms' } }, slot: 'tgt-1' }],
    ['an integer in range', integer, { value: 6, slot: '6' }],
    ['an integer at the top of the range', integer, { value: 10, slot: '10' }],
    [
      'the largest safe integer',
      { ...integer, maxChars: 16, integer: { min: 0, max: Number.MAX_SAFE_INTEGER } },
      { value: Number.MAX_SAFE_INTEGER, slot: String(Number.MAX_SAFE_INTEGER) },
    ],
  ])('writes %s', (_label, capture, { value, slot }) => {
    const verdict = captureWith(capture, value);
    expect(verdict).toEqual({ success: true, value: { branch: 'otp', slot } });
  });

  it.each<[string, IAnswerCapture, JsonValue]>([
    ['text over maxChars', text, 'abcd'],
    ['empty text', text, ''],
    ['text with a control char', text, 'a\nb'],
    ['a number as text', text, 123],
    ['an object of two keys', onlyKey, { a: 1, b: 2 }],
    ['an object of no key', onlyKey, {}],
    ['an array as only key', onlyKey, ['a']],
    ['a key over maxChars', onlyKey, { 'tgt-12': 1 }],
    ['an integer below the range', integer, 3],
    ['an integer above the range', integer, 11],
    ['a fraction', integer, 6.5],
    ['an integer as a string', integer, '6'],
    ['an integer longer than maxChars', { ...integer, maxChars: 1 }, 10],
    [
      'an unsafe integer',
      { ...integer, maxChars: 20, integer: { min: 0, max: Number.MAX_SAFE_INTEGER + 1 } },
      Number.MAX_SAFE_INTEGER + 1,
    ],
  ])('refuses %s', (_label, capture, value) => {
    const verdict = captureWith(capture, value);
    const refused = captureRefused('invalid');
    expect(verdict).toMatchObject(refused);
  });

  it('refuses a capture whose pointer misses', () => {
    const otp: IAnswerCase = { name: 'otp', when: [PENDING], captures: { slot: text } };
    const verdict = classifyWith({ into: 'branch', cases: [otp] }, { state: 'pending' });
    const refused = captureRefused('missing');
    expect(verdict).toMatchObject(refused);
  });

  it('reads the first alternative that resolves', () => {
    const either: IAnswerCapture = { pointer: ['/w', '/v'], maxChars: 3 };
    const verdict = captureWith(either, 'abc');
    expect(verdict).toEqual({ success: true, value: { branch: 'otp', slot: 'abc' } });
  });
});

describe('classifyAnswer — redacted diagnostics', () => {
  const secrets = ['syn-secret-token', 'syn-assertion-9', '864209'];
  const resp = {
    state: 'syn-secret-token',
    data: { list: [{ id: 'syn-assertion-9' }], otp: 864209, ok: true },
  };

  it('logs the shape of an unrecognized answer, never a value', () => {
    const classify = oneCheck(PENDING);
    classifyWith(classify, resp);
    expect(LOG.debug).toHaveBeenCalledTimes(1);
    const data = {
      '<key:0>': [{ '<key:0>': 'string' }],
      '<key:1>': 'number',
      '<key:2>': 'boolean',
    };
    const logged: unknown = LOG.debug.mock.calls[0][0];
    expect(logged).toMatchObject({
      stepName: 'login',
      shape: { '<key:0>': 'string', '<key:1>': data },
    });
    const text = JSON.stringify(LOG.debug.mock.calls);
    const leaked = secrets.filter((secret): boolean => text.includes(secret));
    expect(leaked).toEqual([]);
  });

  it('never logs bank-supplied object keys even when they look like identifiers', () => {
    const bankKey = 'synCustomerNameQ7x';
    const answer = { [bankKey]: { [bankKey]: 'syn-content' } };
    const classifier = oneCheck(PENDING);
    classifyWith(classifier, answer);
    expect(LOG.debug).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(LOG.debug.mock.calls);
    expect(logged).not.toContain(bankKey);
  });

  it('logs the matched case names of an ambiguous answer', () => {
    const anyState: IAnswerCase = {
      name: 'b',
      when: [{ pointer: '/state', text: { maxChars: 99 } }],
    };
    const first: IAnswerCase = { name: 'a', when: [{ pointer: '/data/ok', equals: true }] };
    classifyWith({ into: 'branch', cases: [first, anyState] }, resp);
    const logged: unknown = LOG.debug.mock.calls[0][0];
    expect(logged).toMatchObject({ stepName: 'login', matchedCases: ['a', 'b'] });
  });

  it('logs nothing when one case matches', () => {
    const classify = oneCheck({ pointer: '/data/ok', equals: true });
    classifyWith(classify, resp);
    expect(LOG.debug).not.toHaveBeenCalled();
  });
});
