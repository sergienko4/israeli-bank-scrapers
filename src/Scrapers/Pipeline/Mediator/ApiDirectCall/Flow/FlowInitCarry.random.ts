/**
 * Random bootstraps: `random-hex-16`, `random-hex` and `random-uuid`.
 * Each draws a fresh value per flow init and reads no creds.
 */

import { randomBytes, randomUUID } from 'node:crypto';

import type { Procedure } from '../../../Types/Procedure.js';
import { succeed } from '../../../Types/Procedure.js';
import type { IRandomHexBootstrap, SeedCarryBootstrapKind } from '../ConfigContracts/index.js';

/** Random-hex generator size used by the `'random-hex-16'` bootstrap. */
const RANDOM_HEX_16_BYTES = 16;

/** Bootstrap kinds that draw a fresh random value. */
type RandomBootstrap = Extract<
  SeedCarryBootstrapKind,
  { kind: 'random-hex-16' | 'random-hex' | 'random-uuid' }
>;

/** The random bootstrap config of one kind. */
type RandomOf<TKind extends RandomBootstrap['kind']> = Extract<
  RandomBootstrap,
  { readonly kind: TKind }
>;

/**
 * Generate a fresh 16-byte lower-case hex string.
 * @returns Procedure with the generated value.
 */
function bootstrapRandomHex16(): Procedure<string> {
  const hex = randomBytes(RANDOM_HEX_16_BYTES).toString('hex');
  return succeed(hex);
}

/**
 * Generate fresh hex of the configured length and case.
 * @param bootstrap - The `random-hex` config.
 * @returns Procedure with `2 × bytes` hex characters.
 */
function bootstrapRandomHex(bootstrap: IRandomHexBootstrap): Procedure<string> {
  const hex = randomBytes(bootstrap.bytes).toString('hex');
  const cased = bootstrap.isUpperCase ? hex.toUpperCase() : hex;
  return succeed(cased);
}

/**
 * Generate a fresh canonical UUID v4.
 * @returns Procedure with the generated value.
 */
function bootstrapRandomUuid(): Procedure<string> {
  const uuid = randomUUID();
  return succeed(uuid);
}

/** Generator per random bootstrap kind — add a row, not a branch. */
const RANDOM_BOOTSTRAPS: {
  readonly [TKind in RandomBootstrap['kind']]: (bootstrap: RandomOf<TKind>) => Procedure<string>;
} = {
  'random-hex-16': bootstrapRandomHex16,
  'random-hex': bootstrapRandomHex,
  'random-uuid': bootstrapRandomUuid,
};

/**
 * Narrow a bootstrap descriptor to the random kinds.
 * @param bootstrap - Discriminated bootstrap descriptor.
 * @returns True when the kind draws a random value.
 */
function isRandomBootstrap(bootstrap: unknown): bootstrap is RandomBootstrap {
  if (typeof bootstrap !== 'object' || bootstrap === null) return false;
  const kind: unknown = Reflect.get(bootstrap, 'kind');
  return typeof kind === 'string' && Object.hasOwn(RANDOM_BOOTSTRAPS, kind);
}

/**
 * Draw a random bootstrap value with the generator of its kind.
 * @param bootstrap - Random bootstrap descriptor.
 * @returns Procedure with the drawn value.
 */
function evalRandomBootstrap<TKind extends RandomBootstrap['kind']>(
  bootstrap: RandomOf<TKind>,
): Procedure<string> {
  const kind: TKind = bootstrap.kind;
  const draw = RANDOM_BOOTSTRAPS[kind];
  return draw(bootstrap);
}

export type { RandomBootstrap };
export { evalRandomBootstrap, isRandomBootstrap };
