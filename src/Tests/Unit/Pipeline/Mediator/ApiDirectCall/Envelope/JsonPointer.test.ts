/**
 * Unit tests for JsonPointer — RFC-6901 walker used by
 * GenericEnvelopeParser to resolve bank-supplied selector paths
 * against response envelopes. Zero bank knowledge.
 */

import type { JsonValue } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Envelope/JsonPointer.js';
import { walkPointer } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Envelope/JsonPointer.js';

describe('JsonPointer.walkPointer — basic paths', () => {
  it('walks a simple /a/b object path', () => {
    const doc: JsonValue = { a: { b: 42 } };
    const result = walkPointer(doc, '/a/b');
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toBe(42);
  });

  it('walks into arrays via numeric index', () => {
    const doc: JsonValue = { items: ['alpha', 'beta', 'gamma'] };
    const result = walkPointer(doc, '/items/1');
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toBe('beta');
  });

  it('returns the document itself for an empty pointer', () => {
    const doc: JsonValue = { a: 1 };
    const result = walkPointer(doc, '');
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toBe(doc);
  });

  it('returns the document itself for a root-only pointer "/"', () => {
    const doc: JsonValue = { a: 1 };
    const result = walkPointer(doc, '/');
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toBe(doc);
  });
});

describe('JsonPointer.walkPointer — missing paths', () => {
  it('fails when a key is missing', () => {
    const doc: JsonValue = { a: { b: 1 } };
    const result = walkPointer(doc, '/a/missing');
    expect(result.success).toBe(false);
  });

  it('fails when walking through null', () => {
    const doc: JsonValue = { a: null };
    const result = walkPointer(doc, '/a/b');
    expect(result.success).toBe(false);
  });

  it('fails on out-of-bounds array index', () => {
    const doc: JsonValue = { items: ['only-one'] };
    const result = walkPointer(doc, '/items/5');
    expect(result.success).toBe(false);
  });

  it('fails when walking a primitive', () => {
    const doc: JsonValue = { a: 5 };
    const result = walkPointer(doc, '/a/b');
    expect(result.success).toBe(false);
  });
});

describe('JsonPointer.walkPointer — escape sequences', () => {
  it('unescapes ~1 as /', () => {
    const doc: JsonValue = { 'a/b': 'slash-key' };
    const result = walkPointer(doc, '/a~1b');
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toBe('slash-key');
  });

  it('unescapes ~0 as ~', () => {
    const doc: JsonValue = { 'a~b': 'tilde-key' };
    const result = walkPointer(doc, '/a~0b');
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toBe('tilde-key');
  });

  it('unescapes ~01 correctly (tilde followed by 1, not slash)', () => {
    const doc: JsonValue = { 'a~1b': 'tilde-one-b' };
    const result = walkPointer(doc, '/a~01b');
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toBe('tilde-one-b');
  });
});

describe('JsonPointer.walkPointer — deep nesting', () => {
  it('traverses mixed object-and-array nesting', () => {
    const doc: JsonValue = { data: { rows: [{ id: 'first' }, { id: 'second' }] } };
    const result = walkPointer(doc, '/data/rows/1/id');
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toBe('second');
  });

  it('handles an array of arrays', () => {
    const doc: JsonValue = {
      matrix: [
        [1, 2],
        [3, 4],
      ],
    };
    const result = walkPointer(doc, '/matrix/1/0');
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toBe(3);
  });
});

describe('JsonPointer.walkPointer — array-pick segment (*propName)', () => {
  it('picks the first array element with the named property', () => {
    const doc: JsonValue = {
      headers: [
        { type: 'session_id', session_id: 'ssn-abc' },
        { type: 'device_id', device_id: 'dev-xyz' },
      ],
    };
    const session = walkPointer(doc, '/headers/*session_id');
    expect(session.success).toBe(true);
    if (session.success) expect(session.value).toBe('ssn-abc');
    const device = walkPointer(doc, '/headers/*device_id');
    expect(device.success).toBe(true);
    if (device.success) expect(device.value).toBe('dev-xyz');
  });

  it('fails when no element has the named property', () => {
    const doc: JsonValue = { headers: [{ other: 1 }, { thing: 2 }] };
    const result = walkPointer(doc, '/headers/*session_id');
    expect(result.success).toBe(false);
  });

  it('fails when the cursor at the pick step is not an array', () => {
    const doc: JsonValue = { headers: { not: 'an array' } };
    const result = walkPointer(doc, '/headers/*session_id');
    expect(result.success).toBe(false);
  });
});

describe('JsonPointer.walkPointer — array-filter segment (?k=v)', () => {
  it('filters to the first element whose named prop equals value', () => {
    const doc: JsonValue = {
      methods: [
        { type: 'otp', assertion_id: 'skip-me' },
        { type: 'password', assertion_id: 'pwd-id' },
      ],
    };
    const result = walkPointer(doc, '/methods/?type=password/assertion_id');
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toBe('pwd-id');
  });

  it('fails when no element matches', () => {
    const doc: JsonValue = { methods: [{ type: 'otp' }] };
    const result = walkPointer(doc, '/methods/?type=password/assertion_id');
    expect(result.success).toBe(false);
  });

  it('fails when the filter expression lacks the = separator', () => {
    const doc: JsonValue = { methods: [{ type: 'password' }] };
    const result = walkPointer(doc, '/methods/?typepassword/assertion_id');
    expect(result.success).toBe(false);
  });
});
