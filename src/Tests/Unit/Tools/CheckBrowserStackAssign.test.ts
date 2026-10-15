/**
 * Unit test for the directional differ's rules
 * (`scripts/browser-stack/juggler-assign.mjs`): the value sets of Boolean
 * and Enum, and the walk through named types.
 *
 * <p>A Boolean admits exactly `false` and `true`; an Enum admits the string
 * and boolean literals it lists, and `true` never equals `'true'`. A pair
 * fits when every value the producing side admits is one the consuming side
 * accepts, so a pair that fits must report nothing, and one that does not
 * must report exactly what does not fit: one TYPE-MISMATCH for an Enum with
 * a value a Boolean cannot hold, one ENUM-VALUE per boolean an Enum lacks.
 *
 * <p>A named type may hold the next by renaming it, in a field, as an array
 * item or as a Nullable. However long such a chain is, the differ must reach
 * its end and report there exactly what it would report for the end alone,
 * and a type that two fields share must be compared under each of them.
 * Deltas come out depth-first in key order, so two at one path keep the
 * order of the keys that reach it.
 *
 * <p>A key the consuming side requires may still be left out when its type
 * takes `undefined`. In Juggler's `checkScheme` `t.Any` takes every value,
 * `t.Optional` takes `undefined`, and `t.Nullable` and `t.Recursive` take
 * what they wrap; a String, an Enum, an Array or an object never does. So a
 * key whose Nullable and named layers end in Any is never missing, however
 * many layers there are, and the names count on the consuming side only.
 */

import {
  diffProtocols,
  type IJugglerDelta,
} from '../../../../scripts/browser-stack/juggler-diff.mjs';
import {
  CHAIN_BUDGET_MS,
  CHAIN_LENGTH,
  CHAIN_LINK_NAMES,
  CHAIN_LINKS,
  type ChainLinkName,
  delta,
  event,
  method,
  typeChain,
} from './CheckBrowserStackSources.js';

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

/** A chain of named types, by how each holds the next and how many do. */
interface IChainCase {
  readonly name: ChainLinkName;
  readonly length: number;
}

/** The shortest chain, one link more, and one too long to walk by recursion. */
const CHAIN_LENGTHS: readonly number[] = [1, 2, CHAIN_LENGTH];
const CHAIN_CASES: readonly IChainCase[] = CHAIN_LINK_NAMES.flatMap(name =>
  CHAIN_LENGTHS.map((length): IChainCase => ({ name, length })),
);
const CHAIN_PARAM = "{ a: t.Recursive(ns, 'A0') }";
/** Two fields holding `L`, whose two fields hold `M`. */
const SHARED_PARAMS = "{ a: t.Recursive(ns, 'L'), b: t.Recursive(ns, 'L') }";
const SHARED_L = "ns.L = { x: t.Recursive(ns, 'M'), y: t.Recursive(ns, 'M') };";
const SHARED_PATHS = ['D.m.a.x.v', 'D.m.a.y.v', 'D.m.b.x.v', 'D.m.b.y.v'];
/** Key `a` reaches `D.m.a.b` through a named type; the quoted key `'a.b'` reaches it directly. */
const TIE_PARAMS = "{ 'a.b': t.String, a: t.Recursive(ns, 'N') }";
const TIE_BROWSER_PARAMS = "{ 'a.b': t.Boolean, a: t.Recursive(ns, 'N') }";
const TIE_CLIENT_PRELUDE = 'const ns = {}; ns.N = { b: t.String };';
const TIE_BROWSER_PRELUDE = 'const ns = {}; ns.N = { b: t.Number };';
const TIE_DELTAS: readonly IJugglerDelta[] = [
  delta('request TYPE-MISMATCH D.m.a.b', 'src:String|dst:Number'),
  delta('request TYPE-MISMATCH D.m.a.b', 'src:String|dst:Boolean'),
];

/** How the producing side holds key `a`, and whether that may leave it out. */
interface IPresence {
  readonly field: string;
  readonly isOmittable: boolean;
}

/** A consuming type of key `a`, and whether `checkScheme` takes `undefined` for it. */
interface IDestination {
  readonly type: string;
  readonly isUndefinedTaken: boolean;
}

/** One channel's two sources around key `a`, and the path `a` is reported at. */
interface IPlacement {
  readonly client: string;
  readonly browser: string;
  readonly path: string;
}

/** Two sources with key `a` in one channel: produced as `field`, consumed as `type`. */
type Placement = (field: string, type: string) => IPlacement;

const PRESENCES = {
  absent: { field: '', isOmittable: true },
  optional: { field: 'a: t.Optional(t.String)', isOmittable: true },
  required: { field: 'a: t.String', isOmittable: false },
} as const satisfies Readonly<Record<string, IPresence>>;

/** A key of {@link PRESENCES}. */
type PresenceName = keyof typeof PRESENCES;

/** `W` renames `Z`, a Nullable of `Y`, which is Any; `V` renames `S`, a String. */
const DESTINATION_PRELUDE = [
  "const ns = {}; ns.Y = t.Any; ns.Z = t.Nullable(t.Recursive(ns, 'Y'));",
  "ns.W = t.Recursive(ns, 'Z'); ns.S = t.String; ns.V = t.Recursive(ns, 'S');",
].join(' ');
/** The same names on the producing side, each a String: a name resolved there never ends in Any. */
const SOURCE_PRELUDE = [
  'const ns = {}; ns.Y = t.String; ns.Z = t.String;',
  'ns.W = t.String; ns.S = t.String; ns.V = t.String;',
].join(' ');

/** Consuming types under {@link DESTINATION_PRELUDE}, judged as `checkScheme` judges them. */
const DESTINATIONS: readonly IDestination[] = [
  { type: 't.Any', isUndefinedTaken: true },
  { type: 't.Nullable(t.Any)', isUndefinedTaken: true },
  { type: 't.Nullable(t.Nullable(t.Any))', isUndefinedTaken: true },
  { type: "t.Recursive(ns, 'Y')", isUndefinedTaken: true },
  { type: "t.Nullable(t.Recursive(ns, 'Y'))", isUndefinedTaken: true },
  { type: "t.Recursive(ns, 'W')", isUndefinedTaken: true },
  { type: 't.Optional(t.String)', isUndefinedTaken: true },
  { type: 't.String', isUndefinedTaken: false },
  { type: 't.Nullable(t.String)', isUndefinedTaken: false },
  { type: "t.Recursive(ns, 'S')", isUndefinedTaken: false },
  { type: "t.Nullable(t.Recursive(ns, 'V'))", isUndefinedTaken: false },
  { type: 't.Array(t.Any)', isUndefinedTaken: false },
  { type: '{ v: t.Any }', isUndefinedTaken: false },
  { type: "t.Enum(['x'])", isUndefinedTaken: false },
];

/** Chain links that take `undefined` when the next type does: a rename and a Nullable. */
const LINKS_TAKING_UNDEFINED: ReadonlySet<ChainLinkName> = new Set(['rename', 'nullable']);

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

/**
 * What a chain ending in a String yields against the same chain ending in a
 * Boolean: the one TYPE-MISMATCH of its end, at the path its links spell.
 *
 * @param c - The chain.
 * @returns The deltas the differ must report.
 */
function predictChain(c: IChainCase): IJugglerDelta[] {
  const steps = CHAIN_LINKS[c.name].step.repeat(c.length);
  return [delta(`request TYPE-MISMATCH D.m.a${steps}.v`, 'src:String|dst:Boolean')];
}

/**
 * Source whose params hold `L` twice, and `L` holds `M` twice.
 *
 * @param end - The type of `M`.
 * @returns Source text.
 */
function sharedSource(end: string): string {
  const prelude = `const ns = {}; ${SHARED_L} ns.M = ${end};`;
  return method(SHARED_PARAMS, '{}', prelude);
}

/**
 * Key `a` sent: the client produces it, the browser consumes it.
 *
 * @param field - The client's params member.
 * @param type - The browser's type of `a`.
 * @returns The two sources and the path of `a`.
 */
function requestPlacement(field: string, type: string): IPlacement {
  const client = method(`{ ${field} }`, '{}', SOURCE_PRELUDE);
  const browser = method(`{ a: ${type} }`, '{}', DESTINATION_PRELUDE);
  return { client, browser, path: 'D.m.a' };
}

/**
 * Key `a` returned: the browser produces it, the client consumes it.
 *
 * @param field - The browser's returns member.
 * @param type - The client's type of `a`.
 * @returns The two sources and the path of `a`.
 */
function returnPlacement(field: string, type: string): IPlacement {
  const client = method('{}', `{ a: ${type} }`, DESTINATION_PRELUDE);
  const browser = method('{}', `{ ${field} }`, SOURCE_PRELUDE);
  return { client, browser, path: 'D.m.a' };
}

/**
 * Key `a` in an event: the browser produces it, the client consumes it.
 *
 * @param field - The browser's payload member.
 * @param type - The client's type of `a`.
 * @returns The two sources and the path of `a`.
 */
function eventPlacement(field: string, type: string): IPlacement {
  const client = event(`{ a: ${type} }`, DESTINATION_PRELUDE);
  const browser = event(`{ ${field} }`, SOURCE_PRELUDE);
  return { client, browser, path: 'D.e.a' };
}

const PLACEMENTS = {
  request: requestPlacement,
  return: returnPlacement,
  event: eventPlacement,
} as const satisfies Readonly<Record<string, Placement>>;

/** A key of {@link PLACEMENTS}. */
type ChannelName = keyof typeof PLACEMENTS;

/** One way to produce key `a`, one type to consume it as, in one channel. */
interface IPresenceCase {
  readonly presence: PresenceName;
  readonly destination: IDestination;
  readonly channel: ChannelName;
}

/** What one presence case yields: its MISSING-REQUIRED-FIELD deltas, or all of them. */
interface IPresenceVerdict {
  readonly presence: PresenceName;
  readonly type: string;
  readonly channel: ChannelName;
  readonly deltas: readonly string[];
}

const PRESENCE_NAMES = Object.keys(PRESENCES) as readonly PresenceName[];
const CHANNEL_NAMES = Object.keys(PLACEMENTS) as readonly ChannelName[];
const PRESENCE_CASES: readonly IPresenceCase[] = PRESENCE_NAMES.flatMap(presence =>
  DESTINATIONS.flatMap(destination =>
    CHANNEL_NAMES.map((channel): IPresenceCase => ({ presence, destination, channel })),
  ),
);
const UNDEFINED_TAKEN_CASES = PRESENCE_CASES.filter(c => c.destination.isUndefinedTaken);

/**
 * The deltas the differ reports for one presence case, as `<channel> <kind> <path>`.
 *
 * @param c - The case.
 * @returns Every delta, in order.
 */
function presenceDeltas(c: IPresenceCase): string[] {
  const placement = PLACEMENTS[c.channel](PRESENCES[c.presence].field, c.destination.type);
  const deltas = diffProtocols(placement.client, placement.browser);
  return deltas.map((d): string => `${d.channel} ${d.kind} ${d.path}`);
}

/**
 * The MISSING-REQUIRED-FIELD deltas the differ reports for one presence case.
 *
 * @param c - The case.
 * @returns The case and those deltas.
 */
function observePresence(c: IPresenceCase): IPresenceVerdict {
  const deltas = presenceDeltas(c).filter(line => line.includes(' MISSING-REQUIRED-FIELD '));
  return { presence: c.presence, type: c.destination.type, channel: c.channel, deltas };
}

/**
 * What must be missing: key `a`, exactly when the producer may leave it out
 * and the consuming type does not take `undefined`.
 *
 * @param c - The case.
 * @returns The case and the delta it must yield, if any.
 */
function predictPresence(c: IPresenceCase): IPresenceVerdict {
  const isMissing = PRESENCES[c.presence].isOmittable && !c.destination.isUndefinedTaken;
  const { path } = PLACEMENTS[c.channel]('', c.destination.type);
  const deltas = isMissing ? [`${c.channel} MISSING-REQUIRED-FIELD ${path}`] : [];
  return { presence: c.presence, type: c.destination.type, channel: c.channel, deltas };
}

/**
 * Every delta the differ reports for one presence case.
 *
 * @param c - The case.
 * @returns The case and all its deltas.
 */
function observeAll(c: IPresenceCase): IPresenceVerdict {
  const deltas = presenceDeltas(c);
  return { presence: c.presence, type: c.destination.type, channel: c.channel, deltas };
}

/**
 * No delta at all for one presence case.
 *
 * @param c - The case.
 * @returns The case with no deltas.
 */
function nothingFor(c: IPresenceCase): IPresenceVerdict {
  return { presence: c.presence, type: c.destination.type, channel: c.channel, deltas: [] };
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

describe('Juggler differ through named types', () => {
  it.each(CHAIN_CASES)('[BSD-68] walks a $name chain of $length to the delta at its end', c => {
    const clientPrelude = typeChain(c.name, c.length);
    const browserPrelude = typeChain(c.name, c.length, '{ v: t.Boolean }');
    const client = method(CHAIN_PARAM, '{}', clientPrelude);
    const browser = method(CHAIN_PARAM, '{}', browserPrelude);
    const startedAt = Date.now();
    const deltas = diffProtocols(client, browser);
    const elapsedMs = Date.now() - startedAt;
    const expected = predictChain(c);
    expect(deltas).toEqual(expected);
    expect(elapsedMs).toBeLessThan(CHAIN_BUDGET_MS);
  });

  it('[BSD-69] compares a shared type under every field that holds it', () => {
    const client = sharedSource('{ v: t.String }');
    const browser = sharedSource('{ v: t.Boolean }');
    const deltas = diffProtocols(client, browser);
    const paths = deltas.map((d): string => d.path);
    expect(paths).toEqual(SHARED_PATHS);
  });

  it('[BSD-70] reports two deltas at one path in the order of their keys', () => {
    const client = method(TIE_PARAMS, '{}', TIE_CLIENT_PRELUDE);
    const browser = method(TIE_BROWSER_PARAMS, '{}', TIE_BROWSER_PRELUDE);
    const deltas = diffProtocols(client, browser);
    expect(deltas).toEqual(TIE_DELTAS);
  });
});

describe('Juggler differ on a key the producer may leave out', () => {
  it('[BSD-71] reports a missing key exactly where the consuming type refuses undefined', () => {
    const observed = PRESENCE_CASES.map(observePresence);
    const predicted = PRESENCE_CASES.map(predictPresence);
    expect(PRESENCE_CASES).toHaveLength(126);
    expect(observed).toEqual(predicted);
  });

  it('[BSD-72] reports nothing at all where the consuming type takes undefined', () => {
    const observed = UNDEFINED_TAKEN_CASES.map(observeAll);
    const expected = UNDEFINED_TAKEN_CASES.map(nothingFor);
    expect(UNDEFINED_TAKEN_CASES).toHaveLength(63);
    expect(observed).toEqual(expected);
  });

  it.each(CHAIN_LINK_NAMES)('[BSD-73] follows a long %s chain to the Any at its end', name => {
    const prelude = typeChain(name, CHAIN_LENGTH, 't.Any');
    const browser = method(CHAIN_PARAM, '{}', prelude);
    const client = method('{}');
    const startedAt = Date.now();
    const deltas = diffProtocols(client, browser);
    const elapsedMs = Date.now() - startedAt;
    const lines = deltas.map((d): string => `${d.kind} ${d.path}`);
    const isUndefinedTaken = LINKS_TAKING_UNDEFINED.has(name);
    const expected = isUndefinedTaken ? [] : ['MISSING-REQUIRED-FIELD D.m.a'];
    expect(lines).toEqual(expected);
    expect(elapsedMs).toBeLessThan(CHAIN_BUDGET_MS);
  });
});
