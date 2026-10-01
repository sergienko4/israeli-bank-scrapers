/**
 * Synthetic durable-auth fixtures for the Pepper mocked E2E.
 *
 * A "bound device" is what an earlier enrollment would have left behind: a
 * fresh P-256 key generated at test time, a client-instance UUID and a
 * device ID, encoded through the production codec so the scraper accepts it.
 * The matching public half is handed to the synthetic server as a pre-bound
 * device. Rule #18: no real key, token, device or phone value is committed.
 */

import { generateKeyPairSync, randomUUID } from 'node:crypto';

import ScraperError from '../../../Scrapers/Base/ScraperError.js';
import type { IRehydratedPersistentAuth } from '../../../Scrapers/Pipeline/Mediator/ApiDirectCall/PersistentAuthStateCodec.js';
import {
  decodePersistentAuthState,
  encodePersistentAuthState,
} from '../../../Scrapers/Pipeline/Mediator/ApiDirectCall/PersistentAuthStateCodec.js';
import { formatPhoneNumber } from '../../../Scrapers/Pipeline/Mediator/Credentials/PhoneFormatter.js';
import { isOk } from '../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeJwtExpiringInWithClaims } from '../../Helpers/Jwt.js';
import type { ISeedDevice } from './PepperAuthServer.js';
import { PEPPER_MOCK_CREDS } from './PepperFetchMock.js';

/** Device ID a simulated earlier enrollment left on the server. */
const BOUND_DEVICE_ID = 'syn-bound-device';

/** A bound device: the caller-side state and the server-side registration. */
interface IBoundDevice {
  readonly encoded: string;
  readonly accessToken: string;
  readonly ecPrivateKeyPkcs8Base64: string;
  readonly server: ISeedDevice;
}

/** Records every durable-state publication the scraper makes. */
interface IStateStore {
  readonly published: string[];
  readonly onUpdate: (state: string) => Promise<void>;
  invocations: number;
}

/**
 * Normalise a phone the way Pepper's wire format does.
 * @param phone - Raw credential phone.
 * @returns Wire-format account.
 */
function accountOf(phone: string): string {
  const formatted = formatPhoneNumber(phone, 'international-flat');
  if (!isOk(formatted)) throw new ScraperError('synthetic phone must normalise');
  return formatted.value;
}

/** The account the durable state is bound to: Pepper's wire-format phone. */
const DURABLE_ACCOUNT = accountOf(PEPPER_MOCK_CREDS.phoneNumber);

/** Provider tag plus account every fixture state is checked against. */
const DURABLE_EXPECTATION = { provider: 'pepper', account: DURABLE_ACCOUNT };

/**
 * Build a structurally valid synthetic JWT with its own identity.
 * @param deltaSeconds - `exp` offset from now; negative yields an expired token.
 * @param label - Distinguishing `sub` claim.
 * @returns Unsigned compact JWT.
 */
function syntheticJwt(deltaSeconds: number, label: string): string {
  return makeJwtExpiringInWithClaims(deltaSeconds, { sub: label });
}

/** Overrides that turn a well-formed device into a broken one. */
interface IDeviceOverrides {
  readonly account?: string;
}

/** A freshly generated device key in the two encodings the test needs. */
interface IDeviceKey {
  readonly ecPrivateKeyPkcs8Base64: string;
  readonly publicKeyDer: Buffer;
}

/**
 * Generate a P-256 device key at test time.
 * @returns PKCS#8 private half (base64) and SPKI DER public half.
 */
function generateDeviceKey(): IDeviceKey {
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pkcs8 = pair.privateKey.export({ type: 'pkcs8', format: 'der' });
  const publicKeyDer = pair.publicKey.export({ type: 'spki', format: 'der' });
  return { ecPrivateKeyPkcs8Base64: pkcs8.toString('base64'), publicKeyDer };
}

/**
 * Create a bound device around a freshly generated P-256 key.
 * @param accessToken - JWT the caller-side state carries.
 * @param overrides - Optional account override (another user's state).
 * @returns Encoded state plus the server-side registration.
 */
function makeBoundDevice(accessToken: string, overrides: IDeviceOverrides = {}): IBoundDevice {
  const key = generateDeviceKey();
  const account = overrides.account ?? DURABLE_ACCOUNT;
  const identity = { clientInstanceId: randomUUID(), deviceId: BOUND_DEVICE_ID };
  const secrets = { accessToken, ecPrivateKeyPkcs8Base64: key.ecPrivateKeyPkcs8Base64 };
  const state = { version: 1, provider: 'pepper', account, ...identity, ...secrets } as const;
  const encoded = encodePersistentAuthState(state, { provider: 'pepper', account });
  if (!isOk(encoded)) throw new ScraperError(encoded.errorMessage);
  const server = { ...identity, publicKeyDer: key.publicKeyDer, uid: account };
  return { encoded: encoded.value, ...secrets, server };
}

/**
 * Decode a state the scraper published, against the fixture account.
 * @param encoded - Published opaque state.
 * @returns Rehydrated state.
 */
function decodeDurable(encoded: string): IRehydratedPersistentAuth {
  const decoded = decodePersistentAuthState(encoded, DURABLE_EXPECTATION);
  if (!isOk(decoded)) throw new ScraperError(decoded.errorMessage);
  return decoded.value;
}

/**
 * Create a state store. Counts on entry, so an un-awaited call still counts.
 * @param failure - Optional error the store rejects with (a failed write).
 * @returns Recording store.
 */
function makeStateStore(failure?: Error): IStateStore {
  const store: IStateStore = { published: [], invocations: 0, onUpdate: persist };
  /**
   * Record the published state, or reject like a failed write.
   * @param state - Opaque state to persist.
   * @returns Resolves once recorded.
   */
  async function persist(state: string): Promise<void> {
    store.invocations += 1;
    await Promise.resolve();
    if (failure !== undefined) throw failure;
    store.published.push(state);
  }
  return store;
}

/** Durable-mode credentials: the unchanged public phone shape, no legacy token. */
interface IDurableCreds {
  readonly phoneNumber: string;
  readonly password: string;
  readonly otpCodeRetriever: () => Promise<string>;
}

/**
 * Durable-mode credentials. The public phone credential type still requires
 * an OTP retriever; durable replay and renewal must never call it.
 * @param otpCodeRetriever - Recording retriever.
 * @returns Phone + password + retriever, with no `otpLongTermToken`.
 */
function durableCreds(otpCodeRetriever: () => Promise<string>): IDurableCreds {
  const { phoneNumber, password } = PEPPER_MOCK_CREDS;
  return { phoneNumber, password, otpCodeRetriever };
}

export type { IBoundDevice, IDurableCreds, IStateStore };
export {
  BOUND_DEVICE_ID,
  decodeDurable,
  DURABLE_ACCOUNT,
  durableCreds,
  makeBoundDevice,
  makeStateStore,
  syntheticJwt,
};
