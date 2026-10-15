/**
 * Unit test for the differ's value-set rules between Boolean and Enum
 * (`scripts/browser-stack/juggler-assign.mjs`).
 *
 * <p>A Boolean admits exactly `false` and `true`; an Enum admits the string
 * and boolean literals it lists, and `true` never equals `'true'`. A pair
 * fits when every value the producing side admits is one the consuming side
 * accepts, so a pair that fits must report nothing, and one that does not
 * must report exactly what does not fit: one TYPE-MISMATCH for an Enum with
 * a value a Boolean cannot hold, one ENUM-VALUE per boolean an Enum lacks.
 */

import {
  diffProtocols,
  type IJugglerDelta,
} from '../../../../scripts/browser-stack/juggler-diff.mjs';
import { delta, method } from './CheckBrowserStackSources.js';

/** A literal an Enum may list. */
type EnumValue = string | boolean;

/** Both values a Boolean admits. */
const BOOLEANS: readonly boolean[] = [false, true];
/** Literals whose subsets the oracle tries: both booleans, a spelling of one, a plain string. */
const LITERALS: readonly EnumValue[] = [false, true, 'true', 'x'];
const BOOLEAN_PARAM = method('{ a: t.Boolean }');

/** A client/browser source pair and the exact deltas it must yield. */
interface IDiffCase {
  readonly id: string;
  readonly what: string;
  readonly client: string;
  readonly browser: string;
  readonly expected: readonly IJugglerDelta[];
}

/** A client/browser source pair that must yield no delta. */
interface INoDeltaCase {
  readonly what: string;
  readonly client: string;
  readonly browser: string;
}

/** What one Enum value set yields against a Boolean, both ways. */
interface IVerdict {
  readonly values: readonly EnumValue[];
  readonly toBoolean: readonly string[];
  readonly fromBoolean: readonly string[];
}

const DIFF_CASES: readonly IDiffCase[] = [
  {
    id: 'BSD-60',
    what: 'TYPE-MISMATCH for a string enum value where a Boolean is expected',
    client: method("{ a: t.Enum(['true']) }"),
    browser: BOOLEAN_PARAM,
    expected: [delta('request TYPE-MISMATCH D.m.a', 'src:Enum("true")|dst:Boolean')],
  },
  {
    id: 'BSD-61',
    what: 'TYPE-MISMATCH for a string beside a boolean where a Boolean is expected',
    client: method("{ a: t.Enum(['mixed', true]) }"),
    browser: BOOLEAN_PARAM,
    expected: [delta('request TYPE-MISMATCH D.m.a', 'src:Enum("mixed"|true)|dst:Boolean')],
  },
  {
    id: 'BSD-62',
    what: 'ENUM-VALUE for the boolean an Enum lacks where a Boolean is sent',
    client: BOOLEAN_PARAM,
    browser: method('{ a: t.Enum([true]) }'),
    expected: [delta('request ENUM-VALUE D.m.a=false', 'src:Boolean|dst:Enum(true)')],
  },
  {
    id: 'BSD-63',
    what: 'ENUM-VALUE for both booleans where an Enum lists only their spellings',
    client: BOOLEAN_PARAM,
    browser: method("{ a: t.Enum(['true', 'false']) }"),
    expected: [
      delta('request ENUM-VALUE D.m.a=false', 'src:Boolean|dst:Enum("false"|"true")'),
      delta('request ENUM-VALUE D.m.a=true', 'src:Boolean|dst:Enum("false"|"true")'),
    ],
  },
  {
    id: 'BSD-64',
    what: 'ENUM-VALUE for a returned boolean the client Enum lacks',
    client: method('{}', '{ r: t.Enum([false]) }'),
    browser: method('{}', '{ r: t.Boolean }'),
    expected: [delta('return ENUM-VALUE D.m.r=true', 'src:Boolean|dst:Enum(false)')],
  },
  {
    id: 'BSD-65',
    what: 'TYPE-MISMATCH for a returned string enum value the client takes as Boolean',
    client: method('{}', '{ r: t.Boolean }'),
    browser: method('{}', "{ r: t.Enum(['yes']) }"),
    expected: [delta('return TYPE-MISMATCH D.m.r', 'src:Enum("yes")|dst:Boolean')],
  },
];

const NO_DELTA_CASES: readonly INoDeltaCase[] = [
  {
    what: 'an Enum of true where a Boolean is expected',
    client: method('{ a: t.Enum([true]) }'),
    browser: BOOLEAN_PARAM,
  },
  {
    what: 'an Enum of both booleans where a Boolean is expected',
    client: method('{ a: t.Enum([true, false]) }'),
    browser: BOOLEAN_PARAM,
  },
  {
    what: 'a Boolean where an Enum of both booleans is expected',
    client: BOOLEAN_PARAM,
    browser: method('{ a: t.Enum([true, false]) }'),
  },
  {
    what: 'a Boolean where an Enum of both booleans and a string is expected',
    client: BOOLEAN_PARAM,
    browser: method("{ a: t.Enum([false, true, 'x']) }"),
  },
  {
    what: 'a returned Enum of false the client takes as Boolean',
    client: method('{}', '{ r: t.Boolean }'),
    browser: method('{}', '{ r: t.Enum([false]) }'),
  },
  {
    what: 'a returned Boolean the client takes as an Enum of both booleans',
    client: method('{}', '{ r: t.Enum([true, false]) }'),
    browser: method('{}', '{ r: t.Boolean }'),
  },
];

/**
 * Every subset of {@link LITERALS}, the empty one included.
 *
 * @returns The subsets, one per bit mask.
 */
function literalSets(): EnumValue[][] {
  const count = 2 ** LITERALS.length;
  return Array.from({ length: count }, (_, mask) =>
    LITERALS.filter((_value, at) => Math.floor(mask / 2 ** at) % 2 === 1),
  );
}

/**
 * What the differ reports for one Enum value set against a Boolean.
 *
 * @param values - The Enum's values.
 * @returns Kinds for Enum to Boolean; kind and path for Boolean to Enum.
 */
function observe(values: readonly EnumValue[]): IVerdict {
  const enumParam = method(`{ a: t.Enum(${JSON.stringify(values)}) }`);
  const toDeltas = diffProtocols(enumParam, BOOLEAN_PARAM);
  const fromDeltas = diffProtocols(BOOLEAN_PARAM, enumParam);
  const toBoolean = toDeltas.map((d): string => d.kind);
  const fromBoolean = fromDeltas.map((d): string => `${d.kind} ${d.path}`);
  return { values, toBoolean, fromBoolean };
}

/**
 * What fits, by value set: an Enum fits a Boolean when every value is a
 * boolean; a Boolean fits an Enum except for each boolean the Enum lacks.
 *
 * @param values - The Enum's values.
 * @returns The verdict the differ must reach.
 */
function predict(values: readonly EnumValue[]): IVerdict {
  const isAllBooleans = values.every((value): boolean => typeof value === 'boolean');
  const missing = BOOLEANS.filter((value): boolean => !values.includes(value));
  const toBoolean = isAllBooleans ? [] : ['TYPE-MISMATCH'];
  const fromBoolean = missing.map((value): string => `ENUM-VALUE D.m.a=${String(value)}`);
  return { values, toBoolean, fromBoolean };
}

describe('Juggler differ between Boolean and Enum', () => {
  it.each(DIFF_CASES)('[$id] reports $what', c => {
    const deltas = diffProtocols(c.client, c.browser);
    expect(deltas).toEqual(c.expected);
  });

  it.each(NO_DELTA_CASES)('[BSD-66] reports nothing for $what', c => {
    const deltas = diffProtocols(c.client, c.browser);
    expect(deltas).toEqual([]);
  });

  it('[BSD-67] fits every Enum value set to a Boolean, both ways, by its values', () => {
    const sets = literalSets();
    const observed = sets.map(observe);
    const predicted = sets.map(predict);
    expect(sets).toHaveLength(16);
    expect(observed).toEqual(predicted);
  });
});
