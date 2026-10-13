/**
 * Type declarations for `scripts/browser-stack/juggler-diff.mjs`.
 *
 * The script is plain Node (`allowJs: false` in tsconfig), so the `.ts` tests
 * that drive it need this to type their assertions rather than import `any`.
 */
import type { DELTA_CHANNELS, DELTA_KINDS } from './manifest.mjs';
import type { NormalizedSchema } from './juggler-schema.mjs';

/** Juggler message direction a delta was found on. */
export type DeltaChannel = (typeof DELTA_CHANNELS)[number];

/** What the directional differ found. */
export type JugglerDeltaKind = (typeof DELTA_KINDS)[number];

/** One compatibility delta between a client and a browser schema. */
export interface IJugglerDelta {
  readonly channel: DeltaChannel;
  readonly kind: JugglerDeltaKind;
  readonly path: string;
  readonly signature: string;
}

/** The fields {@link compareDeltas} orders by. */
type DeltaOrderKey = Pick<IJugglerDelta, 'channel' | 'path' | 'kind'>;

/**
 * Deterministic delta order: channel (request, return, event), path, kind.
 *
 * @param a - First delta.
 * @param b - Second delta.
 * @returns Negative, zero or positive.
 */
export function compareDeltas(a: DeltaOrderKey, b: DeltaOrderKey): number;

/**
 * Deltas between a client and a browser schema, sorted by {@link compareDeltas}.
 *
 * @param client - playwright-core's schema.
 * @param browser - Camoufox's schema.
 * @returns Every delta, deterministic.
 */
export function diffSchemas(client: NormalizedSchema, browser: NormalizedSchema): IJugglerDelta[];

/**
 * Parse two `Protocol.js` sources and diff them.
 *
 * @param clientText - playwright-core's `Protocol.js`.
 * @param browserText - Camoufox's `Protocol.js`.
 * @returns Every delta, deterministic.
 * @throws {UnparseableSchemaError} When either source is outside the grammar.
 */
export function diffProtocols(clientText: string, browserText: string): IJugglerDelta[];
