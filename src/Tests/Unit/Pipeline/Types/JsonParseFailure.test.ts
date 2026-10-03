/**
 * Unit tests for Types/JsonParseFailure — V8 `JSON.parse` errors quote the
 * text they rejected, which is a bank response or a captured request body.
 * The descriptor must keep only the error name and the decimal position.
 */

import * as vm from 'node:vm';

import ScraperError from '../../../../Scrapers/Base/ScraperError.js';
import {
  describeJsonParseFailure,
  parseJsonOrThrow,
} from '../../../../Scrapers/Pipeline/Types/JsonParseFailure.js';

/** Card number planted in every malformed body; must never be echoed. */
const CARD_SENTINEL = '4580123412341234';

/**
 * Script that parses `body` in a fresh V8 realm and yields the error —
 * its SyntaxError is not the test realm's, as with Node's own errors
 * under Jest's ESM VM.
 */
const FOREIGN_PARSE = 'try { JSON.parse(body); } catch (error) { error; }';

/**
 * Capture the real engine error for a malformed body.
 * @param body - Text that is not valid JSON.
 * @returns The error JSON.parse threw.
 */
function engineErrorFor(body: string): Error {
  try {
    JSON.parse(body);
  } catch (error) {
    return error as Error;
  }
  throw new ScraperError(`fixture parsed unexpectedly: ${body.length.toString()} chars`);
}

/**
 * Capture what parseJsonOrThrow throws for a malformed body.
 * @param body - Text that is not valid JSON.
 * @returns The thrown value.
 */
function thrownBy(body: string): unknown {
  try {
    return parseJsonOrThrow(body, 'template');
  } catch (error) {
    return error;
  }
}

/** Every V8 message shape: whole-body quote, prefix quote, and positional. */
const MALFORMED_BODIES = [
  { shape: 'short body quoted whole', body: `ACCT${CARD_SENTINEL}` },
  { shape: 'form-encoded body quoted as prefix', body: `card=${CARD_SENTINEL}&id=1` },
  { shape: 'html error page quoted as prefix', body: `<html>${CARD_SENTINEL}</html>` },
  { shape: 'array with trailing comma', body: `[${CARD_SENTINEL},]` },
  { shape: 'object with trailing comma', body: `{"card":"${CARD_SENTINEL}",}` },
  { shape: 'truncated object', body: `{"card":${CARD_SENTINEL}` },
  { shape: 'trailing garbage', body: `{"card":"${CARD_SENTINEL}"} x` },
] as const;

describe('describeJsonParseFailure', () => {
  it.each(MALFORMED_BODIES)('never echoes the body ($shape)', ({ body }) => {
    const error = engineErrorFor(body);

    const text = describeJsonParseFailure(error);

    expect(text).not.toContain(CARD_SENTINEL);
    expect(text).not.toContain('card');
    expect(text).toMatch(/^invalid JSON \(SyntaxError( at position \d+)?\)$/);
  });

  it('keeps the decimal position of a positional parse failure', () => {
    const error = engineErrorFor(`{"card":"${CARD_SENTINEL}",}`);

    const text = describeJsonParseFailure(error);

    expect(text).toBe('invalid JSON (SyntaxError at position 27)');
  });

  it('reports no position when the engine quotes the body instead', () => {
    const error = engineErrorFor(`ACCT${CARD_SENTINEL}`);

    const text = describeJsonParseFailure(error);

    expect(text).toBe('invalid JSON (SyntaxError)');
  });

  it('ignores position-shaped digits that come from the quoted body', () => {
    const error = engineErrorFor('XJSON at position 4580');

    const text = describeJsonParseFailure(error);

    expect(text).toBe('invalid JSON (SyntaxError)');
  });

  it('describes an empty body without quoting anything', () => {
    const error = engineErrorFor('');

    const text = describeJsonParseFailure(error);

    expect(text).toBe('invalid JSON (SyntaxError)');
  });

  it('never echoes the body of a parse error raised in another realm', () => {
    const sandbox = { body: `ACCT${CARD_SENTINEL}` };
    const error = vm.runInNewContext(FOREIGN_PARSE, sandbox) as Error;

    const text = describeJsonParseFailure(error);

    expect(text).toBe('invalid JSON (SyntaxError)');
  });

  it('passes a non-parse error message through unchanged', () => {
    const error = new TypeError('Body is unusable: Body has already been read');

    const text = describeJsonParseFailure(error);

    expect(text).toBe('Body is unusable: Body has already been read');
  });

  it('normalises a thrown non-Error value', () => {
    const text = describeJsonParseFailure('socket hang up');

    expect(text).toBe('socket hang up');
  });
});

describe('parseJsonOrThrow', () => {
  it('returns the parsed value for valid JSON', () => {
    const parsed = parseJsonOrThrow('{"balance":1250}', 'balance read');

    expect(parsed).toEqual({ balance: 1250 });
  });

  it('throws a ScraperError naming the context and position only', () => {
    const body = `{"card":"${CARD_SENTINEL}",}`;

    /**
     * Parse the malformed body under a transport label.
     * @returns Never — the parse throws.
     */
    const parse = (): unknown => parseJsonOrThrow(body, 'fetchPost parse error');

    expect(parse).toThrow(ScraperError);
    expect(parse).toThrow('fetchPost parse error: invalid JSON (SyntaxError at position 27)');
  });

  it('does not chain the engine error as a cause', () => {
    const body = `card=${CARD_SENTINEL}`;

    const caught = thrownBy(body);

    expect(caught).toBeInstanceOf(ScraperError);
    expect((caught as ScraperError).cause).toBeUndefined();
    expect((caught as ScraperError).message).not.toContain(CARD_SENTINEL);
  });
});
