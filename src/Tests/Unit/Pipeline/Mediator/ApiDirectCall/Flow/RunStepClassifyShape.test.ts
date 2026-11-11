/**
 * The redacted answer shape logged when an answer is unrecognized or
 * ambiguous. Values become their JSON type, keys become anonymous positions,
 * at most 6 levels are walked, and at most 64 entries are shown in all.
 */

import { answerShape } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/Steps/RunStep.classify.shape.js';
import type { JsonValue } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/Steps/RunStep.types.js';

/**
 * Nest a leaf under `levels` objects, each holding the given key.
 * @param levels - How many objects wrap the leaf.
 * @param leaf - The innermost value.
 * @param key - Each object's key.
 * @returns The nested value.
 */
function nest(levels: number, leaf: JsonValue, key = 'a'): JsonValue {
  if (levels === 0) return leaf;
  const inner = nest(levels - 1, leaf, key);
  return { [key]: inner };
}

/**
 * An object of `count` numeric keys `k0`, `k1`, ….
 * @param count - Number of keys.
 * @returns The object.
 */
function wide(count: number): JsonValue {
  const keys = Array.from({ length: count }, (_, index): string => `k${String(index)}`);
  const entries = keys.map((key): [string, JsonValue] => [key, 1]);
  return Object.fromEntries(entries);
}

describe('answerShape', () => {
  it.each<[string, JsonValue, JsonValue]>([
    ['a string', 'syn-secret', 'string'],
    ['a number', 864209, 'number'],
    ['a boolean', true, 'boolean'],
    ['null', null, 'null'],
    ['an array', ['syn-a', 1, null], ['string', 'number', 'null']],
    [
      'an object',
      { s: 'syn-a', n: 1, b: false },
      { '<key:0>': 'string', '<key:1>': 'number', '<key:2>': 'boolean' },
    ],
  ])('replaces %s by its type', (_label, value, shape) => {
    const rendered = answerShape(value);
    expect(rendered).toEqual(shape);
  });

  it('redacts every key, including plain identifiers and unusual names', () => {
    const longest = `_${'k'.repeat(31)}`;
    const tooLong = `_${'k'.repeat(32)}`;
    const value = { ok_Key9: 1, 'bad key': 2, מפתח: 3, [longest]: 4, [tooLong]: 5, '9lead': 6 };
    const shape = {
      '<key:0>': 'number',
      '<key:1>': 'number',
      '<key:2>': 'number',
      '<key:3>': 'number',
      '<key:4>': 'number',
      '<key:5>': 'number',
    };
    const rendered = answerShape(value);
    expect(rendered).toEqual(shape);
  });

  it.each<[string, JsonValue, JsonValue]>([
    ['an object', { b: 1, c: 2 }, 'object(2)'],
    ['an array', [1, 2, 3], 'array(3)'],
  ])('walks 6 levels, then counts %s', (_label, deep, summary) => {
    const value = nest(6, deep);
    const shape = nest(6, summary, '<key:0>');
    const rendered = answerShape(value);
    expect(rendered).toEqual(shape);
  });

  it('walks a container that sits on the sixth level', () => {
    const value = nest(5, { b: [1] });
    const shape = nest(5, { '<key:0>': 'array(1)' }, '<key:0>');
    const rendered = answerShape(value);
    expect(rendered).toEqual(shape);
  });

  it('shows 64 keys of a wide object and counts the rest', () => {
    const value = wide(100);
    const shape = answerShape(value) as Record<string, JsonValue>;
    const keys = Object.keys(shape);
    expect(keys).toHaveLength(65);
    expect(shape['...']).toBe('+36');
    expect(shape['<key:63>']).toBe('number');
    expect(keys).not.toContain('k63');
  });

  it('shares the entry budget across levels', () => {
    const items = Array.from({ length: 100 }, (_, index): JsonValue => index);
    const shape = answerShape({ list: items }) as Record<string, JsonValue[]>;
    expect(shape['<key:0>']).toHaveLength(64);
    expect(shape['<key:0>'][62]).toBe('number');
    expect(shape['<key:0>'][63]).toBe('...+37');
  });
});
