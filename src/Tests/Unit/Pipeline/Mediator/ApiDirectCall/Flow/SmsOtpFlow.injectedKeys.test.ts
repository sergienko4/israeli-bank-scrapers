/**
 * Invariant for keys a caller injects into the SMS-OTP flow (durable resume):
 * the flow sends a request only when every filled slot holds a sound key of
 * its slot's algorithm and the signer's slot is filled. Otherwise it fails
 * before any request, naming only the slot. The expected outcome comes from
 * the fixture tags, not from the production check.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import ScraperError from '../../../../../../Scrapers/Base/ScraperError.js';
import type { IApiDirectCallConfig } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { AsymmetricSignerAlgorithm } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/SignerTypes.js';
import type { JsonValueTemplate } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/TemplateTypes.js';
import type { IGenericKeypair } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/CryptoKeyFactory.js';
import { runSmsOtpFlow } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/SmsOtpFlow.js';
import type { WKUrlGroup } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import type { IKeyKind } from '../Crypto/KeyKindFixtures.js';
import { KEY_KINDS } from '../Crypto/KeyKindFixtures.js';
import { type IApiPostCapture, makeStubMediator } from './StubMediator.js';

const BIND_TAG: WKUrlGroup = 'auth.bind';
const HINT = CompanyTypes.OneZero;

beforeAll((): void => {
  registerWkUrl(BIND_TAG, HINT, 'https://example.test/api/bind');
});

/** Bundle slot names, as the flow's keypair bundle declares them. */
type Slot = 'ec' | 'rsa';

/** The documented slot contract: the algorithm each slot's key signs as. */
const SLOT_ALGORITHM: Readonly<Record<Slot, AsymmetricSignerAlgorithm>> = {
  ec: 'ECDSA-P256',
  rsa: 'RSA-2048',
};

/** Signer variants: an asymmetric algorithm, or no signer at all. */
type SignerCase = AsymmetricSignerAlgorithm | 'none';

/** Slot each signer variant signs from; no signer needs no slot. */
const SIGNER_SLOT: Readonly<Record<SignerCase, Slot | false>> = {
  'ECDSA-P256': 'ec',
  'RSA-2048': 'rsa',
  none: false,
};

/**
 * Build a one-step config whose body publishes the signer's public key.
 * @param signer - Signer variant.
 * @returns API-direct-call config literal.
 */
function makeConfig(signer: SignerCase): IApiDirectCallConfig {
  const slot = SIGNER_SLOT[signer];
  const shape: JsonValueTemplate =
    slot === false ? { x: { $literal: 1 } } : { pub: { $ref: `keypair.${slot}.publicKeyBase64` } };
  const base: IApiDirectCallConfig = {
    flow: 'sms-otp',
    envelope: {},
    probe: { queryTag: 'customer' },
    steps: [
      {
        name: 'bind',
        urlTag: BIND_TAG,
        body: { shape },
        extractsToCarry: { token: '/data/accessToken' },
      },
    ],
  };
  if (signer === 'none') return base;
  const canonical = {
    parts: ['bodyJson'] as const,
    separator: '%%',
    escapeFrom: '%%',
    escapeTo: String.raw`\%`,
    sortQueryParams: false,
    clientVersion: '9.9.9',
  };
  return {
    ...base,
    signer: { algorithm: signer, encoding: 'DER', headerName: 'X-Sig', schemeTag: 4, canonical },
  };
}

/** One injected bundle: an optional key kind per slot. */
interface IBundleCase {
  readonly ec?: IKeyKind;
  readonly rsa?: IKeyKind;
}

/** Every slot filling: empty or any key kind, in each slot. */
const SLOT_FILLINGS: readonly (IKeyKind | undefined)[] = [undefined, ...KEY_KINDS];
const BUNDLE_CASES: readonly IBundleCase[] = SLOT_FILLINGS.flatMap(ec =>
  SLOT_FILLINGS.map((rsa): IBundleCase => ({ ec, rsa })),
);

/**
 * Expected acceptance, from the fixture tags and the slot contract alone.
 * @param bundle - Bundle case.
 * @param signer - Signer variant.
 * @returns True when the flow must accept the bundle.
 */
function shouldAccept(bundle: IBundleCase, signer: SignerCase): boolean {
  const slots: readonly Slot[] = ['ec', 'rsa'];
  const isAllSound = slots.every(slot => {
    const kind = bundle[slot];
    return kind === undefined || kind.soundFor === SLOT_ALGORITHM[slot];
  });
  const required = SIGNER_SLOT[signer];
  return isAllSound && (required === false || bundle[required] !== undefined);
}

/**
 * Describe a bundle case for failure output.
 * @param bundle - Bundle case.
 * @param signer - Signer variant.
 * @returns Short label.
 */
function describeCase(bundle: IBundleCase, signer: SignerCase): string {
  return `signer=${signer} ec=${bundle.ec?.label ?? '-'} rsa=${bundle.rsa?.label ?? '-'}`;
}

/**
 * Read the key ID a captured request was signed with.
 * @param capture - Captured apiPost call.
 * @returns Key ID hex from the X-Sig header, or '' when unsigned.
 */
function signedKeyId(capture: IApiPostCapture): string {
  const header = capture.extraHeaders?.['X-Sig'] ?? '';
  return /key-id:([\da-f]+)/.exec(header)?.[1] ?? '';
}

/** What one flow run produced. */
interface IRunOutcome {
  readonly keypairs: { ec?: IGenericKeypair; rsa?: IGenericKeypair };
  readonly captures: readonly IApiPostCapture[];
  readonly result: Awaited<ReturnType<typeof runSmsOtpFlow>>;
}

/**
 * Turn a bundle case into the keypair bundle the flow receives.
 * @param bundle - Bundle case.
 * @returns Keypair bundle with only the filled slots set.
 */
function keypairsOf(bundle: IBundleCase): IRunOutcome['keypairs'] {
  const keypairs: IRunOutcome['keypairs'] = {};
  if (bundle.ec !== undefined) keypairs.ec = bundle.ec.keypair;
  if (bundle.rsa !== undefined) keypairs.rsa = bundle.rsa.keypair;
  return keypairs;
}

/**
 * Run the flow once with the case's keys against a one-response stub.
 * @param bundle - Bundle case.
 * @param signer - Signer variant.
 * @returns Keys, captured requests, and the flow result.
 */
async function runCase(bundle: IBundleCase, signer: SignerCase): Promise<IRunOutcome> {
  const captures: IApiPostCapture[] = [];
  const responses = [succeed({ data: { accessToken: 'tok' } })];
  const bus = makeStubMediator({ responses, captures });
  const keypairs = keypairsOf(bundle);
  const config = makeConfig(signer);
  const result = await runSmsOtpFlow({ config, bus, creds: {}, companyId: HINT, keypairs });
  return { keypairs, captures, result };
}

/**
 * Check an accepted case: it succeeds and signs with the signer's slot key.
 * @param outcome - Run outcome.
 * @param signer - Signer variant.
 * @returns Violation text, or ''.
 */
function acceptedViolation(outcome: IRunOutcome, signer: SignerCase): string {
  if (!outcome.result.success) return `rejected (${outcome.result.errorMessage})`;
  const slot = SIGNER_SLOT[signer];
  const wantKeyId = slot === false ? '' : (outcome.keypairs[slot]?.keyIdHex ?? '');
  const gotKeyIds = outcome.captures.map(signedKeyId).join(',');
  return gotKeyIds === wantKeyId ? '' : `signed with [${gotKeyIds}]`;
}

/**
 * Check a rejected case: it fails before any request, naming only the slot.
 * @param outcome - Run outcome.
 * @returns Violation text, or ''.
 */
function rejectedViolation(outcome: IRunOutcome): string {
  if (outcome.result.success) return 'accepted';
  const sent = outcome.captures.length;
  if (sent > 0) return `sent ${String(sent)} request(s) before failing`;
  const isExact = /^injected keypair (?:invalid|missing): (?:ec|rsa)$/.test(
    outcome.result.errorMessage,
  );
  return isExact ? '' : 'unexpected failure text';
}

/**
 * Run one case and return a violation message, or '' when it holds.
 * @param bundle - Bundle case.
 * @param signer - Signer variant.
 * @returns Violation text, or ''.
 */
async function violationOf(bundle: IBundleCase, signer: SignerCase): Promise<string> {
  const outcome = await runCase(bundle, signer);
  const isAcceptExpected = shouldAccept(bundle, signer);
  const violation = isAcceptExpected
    ? acceptedViolation(outcome, signer)
    : rejectedViolation(outcome);
  return violation === '' ? '' : `${describeCase(bundle, signer)}: ${violation}`;
}

describe('SmsOtpFlow injected keypairs — accepted only when sound', () => {
  const signers: readonly SignerCase[] = ['ECDSA-P256', 'RSA-2048', 'none'];

  it.each(signers)('signer %s: every bundle case holds the invariant', async signer => {
    const runs = BUNDLE_CASES.map(bundle => violationOf(bundle, signer));
    const violations = (await Promise.all(runs)).filter(text => text !== '');
    expect(violations).toEqual([]);
  });

  it('rejects an RSA pair in the ec slot of an ECDSA signer before any request', async () => {
    const rsaKind = KEY_KINDS.find(kind => kind.label === 'RSA-2048');
    if (rsaKind === undefined) throw new ScraperError('fixture missing RSA-2048');
    const captures: IApiPostCapture[] = [];
    const bus = makeStubMediator({ responses: [], captures });
    const keypairs = { ec: rsaKind.keypair };
    const config = makeConfig('ECDSA-P256');
    const result = await runSmsOtpFlow({ config, bus, creds: {}, companyId: HINT, keypairs });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toBe('injected keypair invalid: ec');
    expect(captures).toHaveLength(0);
  });
});
