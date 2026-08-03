/**
 * Unit tests for GenericEnvelopeParser — consumes bank-supplied
 * IEnvelopeSelectors (JSON-pointer map) to pluck values from a
 * response envelope. Zero bank knowledge.
 */

import { extractFields } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Envelope/GenericEnvelopeParser.js';
import type { JsonValue } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Envelope/JsonPointer.js';
import type { IEnvelopeSelectors } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/IApiDirectCallConfig.js';

/** Reusable shape for the happy-path bind-envelope example. */
const BIND_ENVELOPE: JsonValue = {
  data: {
    challenge: 'syn-challenge',
    control_flow: [
      {
        type: 'auth',
        methods: [{ type: 'password', assertion_id: 'syn-pwd-assert' }],
      },
    ],
  },
  headers: [
    { type: 'session_id', session_id: 'syn-session' },
    { type: 'device_id', device_id: 'syn-device' },
  ],
};

/** Reusable selector map used across the happy-path cases. */
const PEPPER_LIKE_SELECTORS: IEnvelopeSelectors = {
  challenge: '/data/challenge',
  assertionId: '/data/control_flow/0/methods/0/assertion_id',
};

describe('GenericEnvelopeParser.extractFields — happy path', () => {
  it('extracts a flat selector map from a nested envelope', () => {
    const result = extractFields(BIND_ENVELOPE, PEPPER_LIKE_SELECTORS);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.challenge).toBe('syn-challenge');
      expect(result.value.assertionId).toBe('syn-pwd-assert');
    }
  });

  it('returns a success with an empty object when selectors map is empty', () => {
    const result = extractFields(BIND_ENVELOPE, {});
    expect(result.success).toBe(true);
    if (result.success) {
      const keys = Object.keys(result.value);
      expect(keys).toHaveLength(0);
    }
  });

  it('preserves runtime types (number, string, array)', () => {
    const doc = {
      count: 3,
      name: 'label',
      items: ['x', 'y'],
    };
    const selectors: IEnvelopeSelectors = {
      count: '/count',
      name: '/name',
      items: '/items',
    };
    const result = extractFields(doc, selectors);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.count).toBe(3);
      expect(result.value.name).toBe('label');
      expect(result.value.items).toEqual(['x', 'y']);
    }
  });
});

describe('GenericEnvelopeParser.extractFields — failure propagation', () => {
  it('fails with selector name + path when a path walks through null', () => {
    const doc = { data: null };
    const selectors: IEnvelopeSelectors = { challenge: '/data/challenge' };
    const result = extractFields(doc, selectors);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('challenge');
      expect(result.errorMessage).toContain('/data/challenge');
    }
  });

  it('fails with the FIRST failing selector (ignores subsequent misses)', () => {
    const doc = {};
    const selectors: IEnvelopeSelectors = {
      first: '/missing-first',
      second: '/missing-second',
    };
    const result = extractFields(doc, selectors);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('first');
      expect(result.errorMessage).not.toContain('second');
    }
  });

  it('fails when the root document is null', () => {
    const selectors: IEnvelopeSelectors = { challenge: '/data/challenge' };
    const result = extractFields(null, selectors);
    expect(result.success).toBe(false);
  });

  it('fails when a selector points into an out-of-bounds array index', () => {
    const doc = { items: [] };
    const selectors: IEnvelopeSelectors = { first: '/items/0' };
    const result = extractFields(doc, selectors);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('/items/0');
  });
});

describe('GenericEnvelopeParser.extractFields — deep + escaped paths', () => {
  it('extracts a deeply-nested value via a 6-segment pointer', () => {
    const doc = { a: { b: { c: { d: { e: { f: 'deep' } } } } } };
    const result = extractFields(doc, { value: '/a/b/c/d/e/f' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.value).toBe('deep');
  });

  it('decodes ~1 escape sequences in selector paths', () => {
    const doc = { 'a/b': 'slash' };
    const result = extractFields(doc, { slashed: '/a~1b' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.slashed).toBe('slash');
  });
});

/**
 * T-ENV — a rejected call still answers HTTP 200, so the selector simply
 * misses. PayBox's `pinValidation` returned `explanation/code/name/message`
 * and the pipeline reported only "envelope selector miss: accessToken2 at
 * /content/access_token" — the one field saying WHY was discarded, leaving the
 * failure undiagnosable from a log.
 */
describe('GenericEnvelopeParser.extractFields — error envelopes (T-ENV)', () => {
  it('T-ENV-1 (FIRING): surfaces the reason the bank gave', () => {
    const doc = { code: 'E123', name: 'PinError', message: 'pin is not valid' };
    const result = extractFields(doc, { accessToken2: '/content/access_token' });
    const reason = result.success ? '' : result.errorMessage;
    expect(reason).toContain('pin is not valid');
  });

  it('T-ENV-2: still names the selector that missed', () => {
    const doc = { explanation: 'session expired' };
    const result = extractFields(doc, { accessToken2: '/content/access_token' });
    const reason = result.success ? '' : result.errorMessage;
    expect(reason).toContain('accessToken2 at /content/access_token');
  });

  it('T-ENV-3: leaves the message unchanged when the envelope explains nothing', () => {
    const doc = { content: { other: 1 } };
    const result = extractFields(doc, { accessToken2: '/content/access_token' });
    const reason = result.success ? '' : result.errorMessage;
    expect(reason).toBe('envelope selector miss: accessToken2 at /content/access_token');
  });

  it('T-ENV-4 (FIRING): skips a blank field for one that carries the reason', () => {
    const doc = { message: '   ', explanation: 'card is blocked' };
    const result = extractFields(doc, { accessToken2: '/content/access_token' });
    const reason = result.success ? '' : result.errorMessage;
    expect(reason).toContain('card is blocked');
  });

  it('T-ENV-5: explains nothing when every error field is blank', () => {
    const doc = { message: '', explanation: '   ', error: '' };
    const result = extractFields(doc, { accessToken2: '/content/access_token' });
    const reason = result.success ? '' : result.errorMessage;
    expect(reason).toBe('envelope selector miss: accessToken2 at /content/access_token');
  });
});
