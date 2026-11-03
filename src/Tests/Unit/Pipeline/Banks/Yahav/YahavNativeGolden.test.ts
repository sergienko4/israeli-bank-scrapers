/**
 * Yahav native BaNCS requests — byte parity with the frozen-clock goldens.
 * For the golden `now`, route, session state and refs,
 * every body string built here must equal the golden body, and the headers
 * the builder owns must equal the golden header map.
 *
 * Three golden headers are added further down the stack and are left out
 * here: `Authorization` (the mediator's bearer scheme), `Cookie` (the session
 * jar) and `BD_IDENT_KEY` (the shape's body digest over the bytes checked
 * here). The mocked end-to-end test compares the full wire header map,
 * those three included. Header names compare in lower case: HTTP names are
 * case-insensitive and the standard ones are sent lower-case so they replace
 * the transport defaults instead of sitting beside them.
 *
 * Each case also runs under several host zones: the envelope offset is the
 * one Asia/Jerusalem has at `now`, never the host's.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  yahavLoginBody,
  yahavReadBody,
} from '../../../../../Scrapers/Pipeline/Banks/Yahav/scrape/YahavNativeEnvelope.js';
import { yahavNativeHeaders } from '../../../../../Scrapers/Pipeline/Banks/Yahav/scrape/YahavNativeHeaders.js';
import {
  type IYahavNativeRef,
  yahavAccountsPayload,
  yahavPortfoliosPayload,
  yahavProfilePayload,
} from '../../../../../Scrapers/Pipeline/Banks/Yahav/scrape/YahavNativePayloads.js';
import {
  yahavBalancePayload,
  yahavTxnsPayload,
} from '../../../../../Scrapers/Pipeline/Banks/Yahav/scrape/YahavNativePayloadsAccount.js';
import type {
  HeaderMap,
  VarsMap,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { serializeJsonBody } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/JsonBody.js';

/** Golden packet kinds, in the order a scrape sends them. */
const KINDS = [
  'bootstrap',
  'profile',
  'portfolios',
  'accounts',
  'balance',
  'transactions',
] as const;

/** One golden packet kind. */
type PacketKind = (typeof KINDS)[number];

/** One golden request as the POC sent it. */
interface IGoldenPacket {
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** One golden file: the frozen clock and the packets built on it. */
interface IGoldenFile {
  readonly fixedMs: number;
  readonly packets: Readonly<Record<PacketKind, IGoldenPacket>>;
}

/** One request as the builders produce it. */
interface IBuiltPacket {
  readonly headers: HeaderMap;
  readonly body: VarsMap;
}

/** Golden headers added below the builders: bearer, cookie jar, digest. */
const NOT_BUILT_HERE = new Set(['authorization', 'cookie', 'bd_ident_key']);

/** Host zones each case runs under. */
const HOST_ZONES = ['UTC', 'America/New_York', 'Asia/Jerusalem'] as const;

const SECURITY = {
  Ver: 'SecurityToken_1.0.0',
  isArchetype: false,
  Token: [{ Ver: 'Token_1.0.0', Val: 'sec-fixture' }],
};
const STATE = { security: SECURITY, csrf: 'csrf-fixture' };
const SESSION = 'sess-fixture';
const XSRF = 'xsrf-fixture';
const MAG = 'mag-fixture';
const PORTFOLIO: IYahavNativeRef = { id: 'PF-1', iorId: 'IOR-PF-1' };
const ACCOUNT: IYahavNativeRef = { id: 'AC-1', iorId: 'IOR-AC-1' };
const ACCOUNT_REFS = { portfolio: PORTFOLIO, account: ACCOUNT };
const FROM = { year: 2026, month: 6, day: 1 };
const TO = { year: 2026, month: 6, day: 30 };

/** A golden kind sent after the login. */
type ReadKind = Exclude<PacketKind, 'bootstrap'>;

/** Payload of every read kind, for the golden refs and window. */
const READS: Readonly<Record<ReadKind, VarsMap>> = {
  profile: yahavProfilePayload(),
  portfolios: yahavPortfoliosPayload(),
  accounts: yahavAccountsPayload(PORTFOLIO),
  balance: yahavBalancePayload(ACCOUNT_REFS),
  transactions: yahavTxnsPayload({ ...ACCOUNT_REFS, from: FROM, to: TO }),
};

const TEST_FILE = fileURLToPath(import.meta.url);
const TEST_DIR = path.dirname(TEST_FILE);
const FIXTURES_DIR = path.join(TEST_DIR, 'Fixtures');

/**
 * Read one season's golden file.
 * @param season - `summer` or `winter`.
 * @returns The parsed golden.
 */
function loadGolden(season: string): IGoldenFile {
  const file = path.join(FIXTURES_DIR, `golden-bodies-${season}.json`);
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw) as IGoldenFile;
}

const GOLDENS: Readonly<Record<string, IGoldenFile>> = {
  summer: loadGolden('summer'),
  winter: loadGolden('winter'),
};

/**
 * The login request: empty session values, no `csrfTkn`.
 * @param route - BaNCS path.
 * @param now - Frozen clock.
 * @returns Built request.
 */
function loginPacket(route: string, now: Date): IBuiltPacket {
  const headers = yahavNativeHeaders({ path: route, mag: MAG, session: '', xsrf: '' });
  return { headers, body: yahavLoginBody(now) };
}

/**
 * A read request replaying the golden session state.
 * @param route - BaNCS path.
 * @param payload - The call's payload.
 * @param now - Frozen clock.
 * @returns Built request.
 */
function readPacket(route: string, payload: VarsMap, now: Date): IBuiltPacket {
  const headers = yahavNativeHeaders({ path: route, mag: MAG, session: SESSION, xsrf: XSRF });
  const body = yahavReadBody({ path: route, now, state: STATE, payload });
  return { headers, body };
}

/**
 * Build one golden kind on its golden route.
 * @param kind - Packet kind.
 * @param route - BaNCS path.
 * @param now - Frozen clock.
 * @returns Built request.
 */
function buildPacket(kind: PacketKind, route: string, now: Date): IBuiltPacket {
  if (kind === 'bootstrap') return loginPacket(route, now);
  return readPacket(route, READS[kind], now);
}

/**
 * A header map with lower-case names, optionally without some names.
 * @param headers - Header map.
 * @param dropped - Lower-case names to leave out.
 * @returns Lower-cased map.
 */
function lowerNames(headers: HeaderMap, dropped = new Set<string>()): Record<string, string> {
  const entries = Object.entries(headers).map(([name, value]): [string, string] => [
    name.toLowerCase(),
    value,
  ]);
  const kept = entries.filter(([name]): boolean => !dropped.has(name));
  return Object.fromEntries(kept);
}

/**
 * The time-zone block of a built body.
 * @param body - Built body.
 * @returns The `TimeStamp.Dttime.Timezone` block.
 */
function timezoneOf(body: VarsMap): Record<string, unknown> {
  const stamp = body.TimeStamp as { Dttime: { Timezone: Record<string, unknown> } };
  return stamp.Dttime.Timezone;
}

const SEASONS = Object.keys(GOLDENS);
const CASES = SEASONS.flatMap((season): [string, PacketKind][] =>
  KINDS.map((kind): [string, PacketKind] => [season, kind]),
);

describe.each(HOST_ZONES)('Yahav native goldens on a %s host', zone => {
  const savedZone = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = zone;
  });

  afterAll(() => {
    process.env.TZ = savedZone;
  });

  it.each(CASES)('%s %s body is byte-identical', (season, kind) => {
    const golden = GOLDENS[season];
    const packet = golden.packets[kind];
    const now = new Date(golden.fixedMs);
    const built = buildPacket(kind, packet.path, now);
    const sent = serializeJsonBody(built.body);
    expect(sent.text).toBe(packet.body);
  });

  it.each(CASES)('%s %s builder headers match', (season, kind) => {
    const golden = GOLDENS[season];
    const packet = golden.packets[kind];
    const now = new Date(golden.fixedMs);
    const built = buildPacket(kind, packet.path, now);
    const sent = lowerNames(built.headers);
    const expected = lowerNames(packet.headers, NOT_BUILT_HERE);
    expect(sent).toEqual(expected);
  });
});

describe('Yahav native timestamp', () => {
  it.each(SEASONS)('%s offset minute is a positive zero', season => {
    const now = new Date(GOLDENS[season].fixedMs);
    const body = yahavLoginBody(now);
    const zoneBlock = timezoneOf(body);
    const isPositiveZero = Object.is(zoneBlock.UTCOffsetMinute, 0);
    expect(isPositiveZero).toBe(true);
  });
});
