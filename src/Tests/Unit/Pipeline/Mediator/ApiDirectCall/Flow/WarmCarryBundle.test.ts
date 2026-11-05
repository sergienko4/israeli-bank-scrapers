/**
 * N28 — carry-bundle warm token codec (UT-WB).
 *
 * The token bundles the carry slots a warm resume needs, and optionally the
 * session jar, in a `v1.` envelope bound to the provider and to a hash of the
 * configured account fields. A token failing any check is refused with a
 * reason only — never a value — so the cold login runs instead.
 */

import { createHash } from 'node:crypto';

import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import {
  decodeWarmBundle,
  encodeWarmBundle,
  type IWarmBundle,
  WARM_BUNDLE_REJECTIONS,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/WarmCarryBundle.js';
import type { Procedure } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { assertOk } from '../../../../../Helpers/AssertProcedure.js';
import { COOKIE_MARKER, WARM_COOKIES } from './WarmJarSpy.js';

type RejectionKey = keyof typeof WARM_BUNDLE_REJECTIONS;

const PROVIDER = 'syn-bank';
const ACCOUNTS = ['syn-num', 'syn-id'] as const;
const IDENTITY = { provider: PROVIDER, accounts: ACCOUNTS } as const;
const LIMIT = 16384;
const SLOTS = ['clientId', 'certPem'] as const;
const CARRY = { clientId: `${COOKIE_MARKER}client`, certPem: `${COOKIE_MARKER}cert` } as const;
const WITH_JAR: IWarmBundle = { carry: CARRY, cookies: WARM_COOKIES };
const WITHOUT_JAR: IWarmBundle = { carry: CARRY, cookies: false };
/** The documented account tag: 16 hex chars of SHA-256 over the JSON array. */
const ACCOUNTS_JSON = JSON.stringify(ACCOUNTS);
const ACCOUNT_TAG = createHash('sha256').update(ACCOUNTS_JSON, 'utf8').digest('hex').slice(0, 16);

/** Who a test bundle belongs to. */
type BundleIdentity = Parameters<typeof encodeWarmBundle>[0];

/**
 * Encode a bundle for an identity that has accounts.
 * @param identity - Provider and account values.
 * @param bundle - Carry slots and jar.
 * @returns A `v1.` token.
 */
function encodeOk(identity: BundleIdentity, bundle: IWarmBundle): string {
  const token = encodeWarmBundle(identity, bundle);
  assertOk(token);
  return token.value;
}

const GOOD = encodeOk(IDENTITY, WITH_JAR);
const GOOD_NO_JAR = encodeOk(IDENTITY, WITHOUT_JAR);

/** What a decode is checked against. */
interface IDecodeOpts {
  readonly maxChars?: number;
  readonly hasCookies?: boolean;
  readonly accounts?: readonly string[];
}

/**
 * Decode a token against the test identity and slots.
 * @param token - Stored token.
 * @param opts - Overrides for the limit, jar flag and accounts.
 * @returns The decoded bundle, or the rejection.
 */
function decode(token: string, opts: IDecodeOpts = {}): Procedure<IWarmBundle> {
  const accounts = opts.accounts ?? ACCOUNTS;
  const maxChars = opts.maxChars ?? LIMIT;
  const hasCookies = opts.hasCookies ?? true;
  return decodeWarmBundle(token, {
    provider: PROVIDER,
    accounts,
    slots: SLOTS,
    hasCookies,
    maxChars,
  });
}

/**
 * Wrap an envelope object the way a `v1.` token carries it.
 * @param envelope - Envelope payload.
 * @returns A `v1.` token.
 */
function wrapObject(envelope: object): string {
  const json = JSON.stringify(envelope);
  const body = Buffer.from(json, 'utf8').toString('base64url');
  return `v1.${body}`;
}

/**
 * The decoded JSON body of a token.
 * @param token - A `v1.` token.
 * @returns Body text.
 */
function bodyOf(token: string): string {
  const encoded = token.slice('v1.'.length);
  return Buffer.from(encoded, 'base64url').toString('utf8');
}

/** A well-formed envelope for the test identity, before tampering. */
const ENVELOPE = { p: PROVIDER, a: ACCOUNT_TAG, s: CARRY, c: WARM_COOKIES } as const;
const BAD_COOKIE = { ...WARM_COOKIES[0], secure: 'yes' };

/** A stored token and the reason it is refused. */
interface IRejectCase {
  readonly label: string;
  readonly token: string;
  readonly reason: RejectionKey;
  readonly opts?: IDecodeOpts;
}

const REJECTED: readonly IRejectCase[] = [
  { label: 'a foreign prefix', token: `v2${GOOD.slice(2)}`, reason: 'prefix' },
  {
    label: 'a token over the limit',
    token: GOOD,
    reason: 'size',
    opts: { maxChars: GOOD.length - 1 },
  },
  { label: 'base64 padding', token: `${GOOD}=`, reason: 'encoding' },
  { label: 'a standard-base64 character', token: `${GOOD.slice(0, -1)}+`, reason: 'encoding' },
  {
    label: 'unreadable JSON',
    token: `v1.${Buffer.from('{').toString('base64url')}`,
    reason: 'json',
  },
  { label: 'a JSON array', token: wrapObject([]), reason: 'schema' },
  {
    label: 'slots that are no object',
    token: wrapObject({ ...ENVELOPE, s: [] }),
    reason: 'schema',
  },
  {
    label: 'another provider',
    token: encodeOk({ ...IDENTITY, provider: 'syn-other' }, WITH_JAR),
    reason: 'provider',
  },
  {
    label: 'other account values',
    token: encodeOk({ ...IDENTITY, accounts: ['syn-num', 'syn-other'] }, WITH_JAR),
    reason: 'account',
  },
  {
    label: 'the account values swapped',
    token: encodeOk({ ...IDENTITY, accounts: ['syn-id', 'syn-num'] }, WITH_JAR),
    reason: 'account',
  },
  {
    label: 'a missing slot',
    token: wrapObject({ ...ENVELOPE, s: { clientId: 'x' } }),
    reason: 'slots',
  },
  {
    label: 'an extra slot',
    token: wrapObject({ ...ENVELOPE, s: { ...CARRY, mag: 'x' } }),
    reason: 'slots',
  },
  {
    label: 'a non-string slot',
    token: wrapObject({ ...ENVELOPE, s: { ...CARRY, certPem: 7 } }),
    reason: 'slots',
  },
  {
    label: 'an empty slot',
    token: wrapObject({ ...ENVELOPE, s: { ...CARRY, certPem: '' } }),
    reason: 'slots',
  },
  {
    label: 'a jar the config does not keep',
    token: GOOD,
    reason: 'cookies',
    opts: { hasCookies: false },
  },
  { label: 'no jar where the config keeps one', token: GOOD_NO_JAR, reason: 'cookies' },
  { label: 'a jar that is no list', token: wrapObject({ ...ENVELOPE, c: {} }), reason: 'cookie' },
  {
    label: 'a bad cookie record',
    token: wrapObject({ ...ENVELOPE, c: [BAD_COOKIE] }),
    reason: 'cookie',
  },
  {
    label: 'a cookie that is no record',
    token: wrapObject({ ...ENVELOPE, c: ['sid'] }),
    reason: 'cookie',
  },
];

describe('carry-bundle warm envelope', () => {
  it.each<[string, string, IWarmBundle]>([
    ['with', GOOD, WITH_JAR],
    ['without', GOOD_NO_JAR, WITHOUT_JAR],
  ])('round-trips the bundle %s a jar', (_label, token, bundle): void => {
    const hasCookies = bundle.cookies !== false;
    const decoded = decode(token, { hasCookies });
    const roundTrip = succeed(bundle);
    const isV1 = token.startsWith('v1.');
    expect(decoded).toEqual(roundTrip);
    expect(isV1).toBe(true);
  });

  it('accepts a token of exactly the limit', (): void => {
    const decoded = decode(GOOD, { maxChars: GOOD.length });
    assertOk(decoded);
  });

  it('binds the documented hash of the account fields, never the values', (): void => {
    const body = bodyOf(GOOD);
    const envelope = JSON.parse(body) as { readonly a: string };
    const decoded = decode(GOOD, { accounts: [' syn-num ', 'syn-id'] });
    expect(envelope.a).toBe(ACCOUNT_TAG);
    expect(body).not.toContain(ACCOUNTS[0]);
    expect(body).not.toContain(ACCOUNTS[1]);
    assertOk(decoded);
  });

  it('keeps no jar key when the bundle has no jar', (): void => {
    const body = bodyOf(GOOD_NO_JAR);
    const envelope = JSON.parse(body) as Readonly<Record<string, unknown>>;
    const hasJar = Object.hasOwn(envelope, 'c');
    expect(hasJar).toBe(false);
  });

  it.each(REJECTED)('refuses $label', (row): void => {
    const decoded = decode(row.token, row.opts);
    const reason = WARM_BUNDLE_REJECTIONS[row.reason];
    const refused = fail(ScraperErrorTypes.Generic, reason);
    expect(decoded).toEqual(refused);
  });

  it.each<[string, readonly string[]]>([
    ['a blank account value', ['syn-num', ' ']],
    ['no account value', []],
  ])('binds no bundle to %s', (_label, accounts): void => {
    const unbound = fail(ScraperErrorTypes.Generic, WARM_BUNDLE_REJECTIONS.unbound);
    const encoded = encodeWarmBundle({ provider: PROVIDER, accounts }, WITH_JAR);
    const decoded = decode(GOOD, { accounts });
    expect(encoded).toEqual(unbound);
    expect(decoded).toEqual(unbound);
  });
});
