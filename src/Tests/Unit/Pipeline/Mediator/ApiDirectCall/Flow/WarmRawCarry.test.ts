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
import { accountsTag } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/WarmTokenParts.js';
import {
  fail,
  type Procedure,
  succeed,
} from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Rejection reason a token shape must produce. */
type RejectionReason = 'account' | 'prefix' | 'size' | 'provider' | 'unbound';

/** The production message for each reason this suite exercises. */
const REJECTION_TEXT: Readonly<Record<RejectionReason, string>> = {
  account: 'token belongs to another account',
  prefix: 'not a v1 raw-carry token',
  size: 'token longer than maxTokenChars',
  provider: 'token belongs to another provider',
  unbound: 'no account to bind the token to',
};

const PROVIDER = 'syn-bank';
const ACCOUNTS = ['syn-num', 'syn-id'] as const;
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

const GOOD = encode(IDENTITY);
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
    const parsed = JSON.parse(body) as { a: string };
    const tag = accountsTag(ACCOUNTS, tagKey);
    expect(parsed.a).toBe(tag);
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

  it('still opens a legacy unkeyed token when a key is supplied', (): void => {
    const opened = decode(GOOD, { tagKey });
    const success = succeed(VALUE);
    expect(opened).toEqual(success);
  });
});
