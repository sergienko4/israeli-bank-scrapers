/**
 * A step's carry generators are checked when the pipeline is built:
 * an `rsa-key` generator must name at least one target slot. An
 * `ecdh-key` generator needs two distinct slots, and its private key never
 * reaches `sessionCarry`. A `random-hex` seed draws 1 to 64 bytes.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import {
  type IApiDirectRuleInput,
  validateApiDirectConfig,
} from '../../../../../Scrapers/Pipeline/Core/Builder/ApiDirectConfigRules.js';
import type {
  ICarryGenerator,
  ICsrSubjectEntry,
  IStepConfig,
  SeedCarryBootstrapKind,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';

const TARGET_MSG = 'steps.generate: rsa-key needs keyInto or spkiSha256HexInto';
const CSR_MSG = 'steps.generate: pkcs10-csr needs a subject and into';
const ECDH_SLOTS_MSG = 'steps.generate: ecdh-key needs distinct publicInto and privateInto';
const ECDH_PRIVATE_MSG = 'steps.generate: ecdh-key privateInto must not be a sessionCarry slot';

/**
 * An ECDH generator writing the given slots.
 * @param publicInto - Public point slot.
 * @param privateInto - Private scalar slot.
 * @returns Generator config.
 */
function ecdhOf(publicInto: string, privateInto: string): ICarryGenerator {
  return { kind: 'ecdh-key', curve: 'secp256k1', publicInto, privateInto };
}

const ECDH_KEY = ecdhOf('ecdhPublic', 'ecdhPrivate');
const RANDOM_HEX_MSG = 'seedCarryFromCreds: random-hex needs integer bytes from 1 to 64';
const FRESH_SEED_MSG = 'seedCarryFromCreds: alwaysBootstrap needs a random bootstrap';

/**
 * Rule input seeding `flowId` from a `random-hex` bootstrap of some length.
 * @param bytes - Random bytes the seed draws.
 * @returns Rule input.
 */
function seededOf(bytes: number): IApiDirectRuleInput {
  const input = runOf(ECDH_KEY);
  const bootstrap = { kind: 'random-hex', bytes, isUpperCase: true } as const;
  const seedCarryFromCreds = ['phone', { field: 'flowId', bootstrap }];
  return { ...input, call: { ...input.call, seedCarryFromCreds } };
}

/**
 * Rule input asking for an unconditional seed.
 * @param bootstrap - Candidate generator.
 * @returns Rule input.
 */
function alwaysSeededOf(bootstrap?: SeedCarryBootstrapKind): IApiDirectRuleInput {
  const input = runOf(ECDH_KEY);
  const seed = { field: 'flowId', bootstrap, alwaysBootstrap: true } as const;
  return { ...input, call: { ...input.call, seedCarryFromCreds: [seed] } };
}

/**
 * A CSR generator with the given subject and slot.
 * @param subject - Subject entries.
 * @param into - Carry slot.
 * @returns Generator config.
 */
function csrOf(subject: readonly ICsrSubjectEntry[], into: string): ICarryGenerator {
  return { kind: 'pkcs10-csr', keyRef: 'carry.certKeyPem', subject, into };
}

const CN: ICsrSubjectEntry = { attr: 'CN', value: { $literal: 'device' } };

/**
 * Rule input whose one login step runs the given generator.
 * @param generator - The step's generator.
 * @returns Rule input.
 */
function runOf(generator: ICarryGenerator): IApiDirectRuleInput {
  const step: IStepConfig = {
    name: 'register',
    urlTag: 'auth.bind',
    generate: [generator],
    body: { shape: {} },
    extractsToCarry: { ecdhPublic: '/key', session: '/session' },
  };
  return { call: { flow: 'sms-otp', envelope: {}, steps: [step] }, headless: false };
}

/**
 * Rule input whose one login step runs the given generator, keeping slots.
 * @param generator - The step's generator.
 * @param sessionCarry - The `sessionCarry` allowlist.
 * @returns Rule input.
 */
function keptOf(generator: ICarryGenerator, sessionCarry: readonly string[]): IApiDirectRuleInput {
  const input = runOf(generator);
  return { ...input, call: { ...input.call, sessionCarry } };
}

describe('validateApiDirectConfig — carry generators', () => {
  it('an rsa-key generator with no target fails the build', () => {
    const input = runOf({ kind: 'rsa-key', bits: 2048 });
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: TARGET_MSG,
    });
  });

  it.each<[string, ICarryGenerator]>([
    ['keyInto', { kind: 'rsa-key', bits: 2048, keyInto: 'certKeyPem' }],
    ['spkiSha256HexInto', { kind: 'rsa-key', bits: 2048, spkiSha256HexInto: 'deviceId' }],
    ['a subject and into', csrOf([CN], 'csr')],
    ['an ecdh-key pair of slots', ECDH_KEY],
  ])('a generator naming %s passes', (_label, generator) => {
    const input = runOf(generator);
    const result = validateApiDirectConfig(input);
    expect(result).toEqual({ success: true, value: true });
  });

  it.each<[string, ICarryGenerator]>([
    ['an empty subject', csrOf([], 'csr')],
    ['a blank into', csrOf([CN], ' ')],
  ])('a pkcs10-csr generator with %s fails the build', (_label, generator) => {
    const input = runOf(generator);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({ success: false, errorMessage: CSR_MSG });
  });

  it.each<[string, ICarryGenerator]>([
    ['a blank publicInto', ecdhOf(' ', 'ecdhPrivate')],
    ['a blank privateInto', ecdhOf('ecdhPublic', '')],
    ['one slot for both', ecdhOf('ecdhKey', 'ecdhKey')],
  ])('an ecdh-key generator with %s fails the build', (_label, generator) => {
    const input = runOf(generator);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({ success: false, errorMessage: ECDH_SLOTS_MSG });
  });

  it.each<[string, ICarryGenerator]>([
    ['a slot no step extracts', ECDH_KEY],
    ['a slot a step also extracts', ecdhOf('ecdhPublic', 'session')],
  ])('an ecdh-key privateInto kept as %s fails the build', (_label, generator) => {
    const privateInto = generator.kind === 'ecdh-key' ? generator.privateInto : '';
    const input = keptOf(generator, [privateInto]);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({ success: false, errorMessage: ECDH_PRIVATE_MSG });
  });

  it('an ecdh-key public point kept in sessionCarry passes', () => {
    const input = keptOf(ECDH_KEY, ['ecdhPublic']);
    const result = validateApiDirectConfig(input);
    expect(result).toEqual({ success: true, value: true });
  });

  it.each([0, 65, 1.5, Number.NaN])('a random-hex seed of %s bytes fails the build', bytes => {
    const input = seededOf(bytes);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({ success: false, errorMessage: RANDOM_HEX_MSG });
  });

  it.each([1, 32, 64])('a random-hex seed of %i bytes passes', bytes => {
    const input = seededOf(bytes);
    const result = validateApiDirectConfig(input);
    expect(result).toEqual({ success: true, value: true });
  });

  it.each<SeedCarryBootstrapKind | undefined>([
    undefined,
    { kind: 'sha256-prefix-16', from: 'phone' },
    { kind: 'jwt-claim', from: 'token', claim: 'uid' },
  ])('rejects an always-bootstrap seed without a random generator: %s', bootstrap => {
    const input = alwaysSeededOf(bootstrap);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({ success: false, errorMessage: FRESH_SEED_MSG });
  });

  it('accepts an always-bootstrap random seed', () => {
    const bootstrap = { kind: 'random-hex', bytes: 32, isUpperCase: true } as const;
    const input = alwaysSeededOf(bootstrap);
    const result = validateApiDirectConfig(input);
    expect(result).toEqual({ success: true, value: true });
  });

  it('rejects an untyped false unconditional-bootstrap flag', () => {
    const input = alwaysSeededOf({ kind: 'random-uuid' });
    const seed = input.call.seedCarryFromCreds?.[0];
    if (typeof seed !== 'object') throw new TypeError('missing seed');
    Reflect.set(seed, 'alwaysBootstrap', false);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({ success: false, errorMessage: FRESH_SEED_MSG });
  });
});
