/**
 * Durable device-auth options lifted out of `ScraperOptions`.
 *
 * <p>Both options carry secrets: the opaque state embeds a bearer token and a
 * device private key. They travel in this record and never in the merged
 * credentials that feed template resolution, carry snapshots, or logs. Mode
 * selection happens later and only for banks whose config opts into durable
 * device auth; every other bank ignores this record.
 */

import type { Option } from '../Option.js';

/** Caller hook that durably stores replacement device-auth state. */
type PersistentAuthStateCallback = (state: string) => Promise<void>;

/** Durable device-auth options as supplied, before bank-specific validation. */
interface IPersistentAuthInput {
  /** Opaque encoded state, when supplied as a string. */
  readonly state: Option<string>;
  /** State-update callback, when supplied as a function. */
  readonly onUpdate: Option<PersistentAuthStateCallback>;
  /** True when either option was supplied with the wrong runtime type. */
  readonly isMalformed: boolean;
}

export type { IPersistentAuthInput, PersistentAuthStateCallback };
