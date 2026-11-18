/**
 * Raw carry warm-token codec (UT-WR). A raw token is one carry value — a
 * login hash, a device key or a JWT — wrapped in a `v1.` envelope bound to a
 * provider and account values. A token without the prefix is the legacy raw
 * form and is still accepted by the strategy.
 */

import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import {
  decodeRawCarry,
  encodeRawCarry,
  type IRawCarryExpectation,
  isRawCarryToken,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/WarmRawCarry.js';
import {
  fail,
  type Procedure,
  succeed,
} from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { expectedTag, legacyTag } from './WarmTagFixture.js';

/** Rejection reason a token shape must produce. */
type RejectionReason =
  'account' | 'encoding' | 'json' | 'prefix' | 'provider' | 'schema' | 'size' | 'unbound' | 'value';

/** The production message for each reason this suite exercises. */
const REJECTION_TEXT: Readonly<Record<RejectionReason, string>> = {
  account: 'token belongs to another account',
  encoding: 'token body is not canonical base64url',
  json: 'token body is not JSON',
  prefix: 'not a v1 raw-carry token',
  provider: 'token belongs to another provider',
  schema: 'token body is not a raw-carry token',
  size: 'token longer than maxTokenChars',
  unbound: 'no account to bind the token to',
  value: 'token carries no value',
};

const PROVIDER = 'syn-bank';
const ACCOUNTS = ['syn-num', 'syn-id'] as const;
const ACCOUNTS_JSON = JSON.stringify(ACCOUNTS);
const IDENTITY = { provider: PROVIDER, accounts: ACCOUNTS } as const;
const VALUE = 'syn-raw-carry-value';
const LIMIT = 16384;

/** Who a test token belongs to. */
type RawIdentity = Parameters<typeof encodeRawCarry>[0];

/**
 * Encode a token for an identity.
 * @param identity - Provider and account values.
 * @returns A `v1.` token.
 */
function encode(identity: RawIdentity): string {
  const token = encodeRawCarry(identity, VALUE);
  expect(token.success).toBe(true);
  if (!token.success) return '';
  return token.value;
}

/**
 * Decode a token against the test identity.
 * @param token - Stored token.
 * @param overrides - Expected values to replace.
 * @returns The raw value, or the rejection.
 */
function decode(token: string, overrides: Partial<IRawCarryExpectation> = {}): Procedure<string> {
  return decodeRawCarry(token, {
    provider: PROVIDER,
    accounts: ACCOUNTS,
    maxChars: LIMIT,
    ...overrides,
  });
}

/** A stored token and the reason it is refused. */
interface IRejectCase {
  readonly label: string;
  readonly token: string;
  readonly expected: Partial<IRawCarryExpectation>;
  readonly reason: RejectionReason;
}

/**
 * Wrap JSON text as a `v1.` token.
 * @param text - Envelope JSON text.
 * @returns A `v1.` token.
 */
function wrapText(text: string): string {
  const body = Buffer.from(text, 'utf8').toString('base64url');
  return `v1.${body}`;
}

const GOOD = encode(IDENTITY);
const EMPTY_TAG = legacyTag(ACCOUNTS_JSON);
const EMPTY_JSON = JSON.stringify({ p: PROVIDER, a: EMPTY_TAG, v: '' });
const EMPTY_VALUE = wrapText(EMPTY_JSON);
const REJECTED: readonly IRejectCase[] = [
  { label: 'a foreign prefix', token: `v2${GOOD.slice(2)}`, expected: {}, reason: 'prefix' },
  {
    label: 'a token over the limit',
    token: GOOD,
    expected: { maxChars: GOOD.length - 1 },
    reason: 'size',
  },
  {
    label: 'another provider',
    token: encode({ ...IDENTITY, provider: 'syn-other' }),
    expected: {},
    reason: 'provider',
  },
  {
    label: 'another account',
    token: encode({ ...IDENTITY, accounts: ['syn-other'] }),
    expected: {},
    reason: 'account',
  },
  { label: 'no bound account', token: GOOD, expected: { accounts: [] }, reason: 'unbound' },
  {
    label: 'a blank account',
    token: GOOD,
    expected: { accounts: [' '] },
    reason: 'unbound',
  },
  { label: 'unreadable JSON', token: wrapText('{'), expected: {}, reason: 'json' },
  { label: 'a JSON array', token: wrapText('[]'), expected: {}, reason: 'schema' },
  { label: 'a non-canonical body', token: `${GOOD}=`, expected: {}, reason: 'encoding' },
  { label: 'an empty value', token: EMPTY_VALUE, expected: {}, reason: 'value' },
];

describe('raw carry warm envelope', () => {
  it('round-trips the raw value', (): void => {
    const decoded = decode(GOOD);
    const expected = succeed(VALUE);
    expect(decoded).toEqual(expected);
  });

  it('looks like a v1 token and never stores an account', (): void => {
    const encoded = GOOD.slice('v1.'.length);
    const bytes = Buffer.from(encoded, 'base64url');
    const body = bytes.toString('utf8');
    const isEnvelope = isRawCarryToken(GOOD);
    const isLegacy = isRawCarryToken(VALUE);
    expect(isEnvelope).toBe(true);
    expect(isLegacy).toBe(false);
    expect(body).not.toContain(ACCOUNTS[0]);
    expect(body).not.toContain(ACCOUNTS[1]);
  });

  it('refuses to encode an empty value', (): void => {
    const encoded = encodeRawCarry(IDENTITY, '');
    const expected = fail(ScraperErrorTypes.Generic, REJECTION_TEXT.value);
    expect(encoded).toEqual(expected);
  });

  it('refuses to encode without an account', (): void => {
    const encoded = encodeRawCarry({ ...IDENTITY, accounts: [] }, VALUE);
    const expected = fail(ScraperErrorTypes.Generic, REJECTION_TEXT.unbound);
    expect(encoded).toEqual(expected);
  });

  it.each(REJECTED)('refuses $label', (row: IRejectCase): void => {
    const expected = fail(ScraperErrorTypes.Generic, REJECTION_TEXT[row.reason]);
    const decoded = decode(row.token, row.expected);
    expect(decoded).toEqual(expected);
  });
});

describe('raw carry keyed account tag', () => {
  const tagKey = 'syn-password';

  it('writes an HMAC tag when a key is supplied', (): void => {
    const token = encode({ ...IDENTITY, tagKey });
    const encoded = token.slice('v1.'.length);
    const bytes = Buffer.from(encoded, 'base64url');
    const body = bytes.toString('utf8');
    const parsed = JSON.parse(body) as { a: string; n: string };
    const tag = expectedTag(ACCOUNTS_JSON, tagKey, parsed.n);
    expect(parsed.a).toBe(tag);
  });

  it('uses a fresh nonce for every token', (): void => {
    const first = encode({ ...IDENTITY, tagKey });
    const second = encode({ ...IDENTITY, tagKey });
    const firstEncoded = first.slice('v1.'.length);
    const firstBytes = Buffer.from(firstEncoded, 'base64url');
    const firstBody = firstBytes.toString('utf8');
    const secondEncoded = second.slice('v1.'.length);
    const secondBytes = Buffer.from(secondEncoded, 'base64url');
    const secondBody = secondBytes.toString('utf8');
    const firstParsed = JSON.parse(firstBody) as { a: string; n: string };
    const secondParsed = JSON.parse(secondBody) as { a: string; n: string };
    expect(firstParsed.n).not.toBe(secondParsed.n);
    expect(firstParsed.a).not.toBe(secondParsed.a);
  });

  it('opens a keyed token only with the same key', (): void => {
    const token = encode({ ...IDENTITY, tagKey });
    const opened = decode(token, { tagKey });
    const refused = decode(token, { tagKey: 'syn-other' });
    const accountFailure = fail(ScraperErrorTypes.Generic, REJECTION_TEXT.account);
    const success = succeed(VALUE);
    expect(opened).toEqual(success);
    expect(refused).toEqual(accountFailure);
  });

  it('rejects a nonce-bearing envelope with an unkeyed tag', (): void => {
    const nonce = '00112233445566778899aabbccddeeff';
    const unkeyedTag = legacyTag(ACCOUNTS_JSON);
    const body = JSON.stringify({ p: PROVIDER, a: unkeyedTag, n: nonce, v: VALUE });
    const token = wrapText(body);
    const decoded = decode(token, { tagKey: 'syn-key' });
    const accountFailure = fail(ScraperErrorTypes.Generic, REJECTION_TEXT.account);
    expect(decoded).toEqual(accountFailure);
  });

  it('still opens a legacy unkeyed token when a key is supplied', (): void => {
    const opened = decode(GOOD, { tagKey });
    const success = succeed(VALUE);
    expect(opened).toEqual(success);
  });
});
