/**
 * Beinleumi mocked run inputs — what a run hands the scraper besides the
 * credentials: the SMS retriever, the stored device state and the callback
 * that stores the next one.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 */

import type { ScraperOptions } from '../../../Scrapers/Base/Interface.js';
import { encodeDeviceMemoryState } from '../../../Scrapers/Pipeline/Mediator/ApiDirectCall/DeviceMemoryStateCodec.js';
import { BN_UID } from './BeinleumiMockData.js';
import { BN_PROVIDER } from './BeinleumiWireSpec.js';

/** The SMS retriever, or nothing when the run supplies none. */
export type RetrieverSlot = Pick<ScraperOptions, 'otpCodeRetriever'>;

/** The persistence slots a run hands the options. */
export type PersistSlot = Pick<
  ScraperOptions,
  'persistentAuthState' | 'onPersistentAuthStateUpdate'
>;

/** How the run stores device state: records each one, notes then rejects it, or no callback. */
export type StorageCallback = 'record' | 'reject' | false;

/** The owner a Beinleumi device state is bound to. */
export const BN_OWNER = { provider: BN_PROVIDER, account: BN_UID } as const;

/**
 * Answer the run's code, noting the hint the prompt names.
 * @param hints - Receives each prompt's hint.
 * @param code - The code the retriever answers.
 * @param hint - The hint the prompt names.
 * @returns The code.
 */
function answerCode(hints: string[], code: string, hint: string): Promise<string> {
  hints.push(hint);
  return Promise.resolve(code);
}

/**
 * The SMS retriever a run supplies.
 * @param code - The code it answers; false: the run supplies none.
 * @param hints - Receives each prompt's hint.
 * @returns The retriever slot, empty when the run supplies none.
 */
export function retrieverOf(code: string | false, hints: string[]): RetrieverSlot {
  if (code === false) return {};
  return { otpCodeRetriever: answerCode.bind(null, hints, code) };
}

/**
 * Record a published state.
 * @param published - Receives the state.
 * @param state - The state the run published.
 * @returns Resolves once recorded.
 */
function recordState(published: string[], state: string): Promise<void> {
  published.push(state);
  return Promise.resolve();
}

/**
 * Refuse to store a state, still noting the state it was handed.
 * @param published - Receives the state.
 * @param state - The state the run published.
 * @returns A rejection.
 */
function refuseState(published: string[], state: string): Promise<void> {
  published.push(state);
  const failure = new Error('SYN storage down');
  return Promise.reject(failure);
}

/**
 * The storage callback a run supplies.
 * @param kind - What it does.
 * @param published - Receives each state it is handed.
 * @returns The callback slot.
 */
export function callbackOf(kind: StorageCallback, published: string[]): PersistSlot {
  if (kind === false) return {};
  if (kind === 'reject') return { onPersistentAuthStateUpdate: refuseState.bind(null, published) };
  return { onPersistentAuthStateUpdate: recordState.bind(null, published) };
}

/**
 * A device state, stored for an account.
 * @param deviceId - The device id it names.
 * @param account - The account it is bound to.
 * @returns The opaque state.
 */
export function storedState(deviceId: string, account: string = BN_UID): string {
  const owner = { ...BN_OWNER, account };
  const state = { version: 1, kind: 'device-memory', ...owner, deviceId } as const;
  const encoded = encodeDeviceMemoryState(state, owner);
  if (!encoded.success) throw new TypeError('synthetic device state must encode');
  return encoded.value;
}
