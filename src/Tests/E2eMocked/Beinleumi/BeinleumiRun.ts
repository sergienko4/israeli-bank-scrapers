/**
 * Beinleumi mocked run — one scrape through the public factory against the
 * synthetic bank, recording every call, every SMS prompt and every device
 * state the run published.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 */

import type {
  IScraperScrapingResult,
  ScraperCredentials,
  ScraperOptions,
} from '../../../Scrapers/Base/Interface.js';
import createScraper from '../../../Scrapers/Registry/Factory.js';
import type { IRecordedCall } from '../Helpers/FetchMockKit.js';
import type { IFibiMockBrand } from './BeinleumiBrands.js';
import { BEINLEUMI_MOCK_BRAND } from './BeinleumiBrands.js';
import type { BeinleumiFault, IBeinleumiMockState } from './BeinleumiFaults.js';
import { freshState } from './BeinleumiFaults.js';
import { installBeinleumiFetchMock } from './BeinleumiFetchMock.js';
import { BEINLEUMI_MOCK_CREDS, BEINLEUMI_MOCK_START_DATE, BN_OTP } from './BeinleumiMockData.js';
import type { PersistSlot, RetrieverSlot, StorageCallback } from './BeinleumiRunInputs.js';
import { callbackOf, ownerOf, retrieverOf, storedState } from './BeinleumiRunInputs.js';
import { WIRE_PATHS } from './BeinleumiWireSpec.js';

/** What one run sent, received, asked the caller for and published. */
export interface IBeinleumiRun {
  readonly result: IScraperScrapingResult;
  readonly calls: readonly IRecordedCall[];
  /** Each call by route name, in order. */
  readonly trail: readonly string[];
  readonly state: IBeinleumiMockState;
  /** The hint each retriever call received, in order. */
  readonly hints: readonly string[];
  /** Each device state the run handed the storage callback, in order. */
  readonly published: readonly string[];
  /** The device state the run was handed ('' when none). */
  readonly stored: string;
}

/** Credential overrides, the SMS retriever, and the stored device state. */
export interface IRunSetup {
  readonly creds?: Readonly<Record<string, string>>;
  /** The code the retriever answers; false: the run supplies none. */
  readonly otp?: string | false;
  /** Where the run hands the retriever: the credentials (default) or the options. */
  readonly retrieverIn?: 'creds' | 'options';
  /** The device id a stored state names; '' (default) for no stored state. */
  readonly storedDid?: string;
  /** The account the stored state names (default: the user). */
  readonly stateAccount?: string;
  readonly callback?: StorageCallback;
  /** The group bank the run scrapes (default: Beinleumi). */
  readonly brand?: IFibiMockBrand;
  /** The bank the stored state names (default: the run's bank). */
  readonly stateBrand?: IFibiMockBrand;
}

/** The opening: the login page, the envelope, the login, the password. */
export const OPENING_TRAIL = ['prime', 'encryptionKey', 'login', 'assertPassword'];

/** The SMS step the bank asks for: the trigger, then the code. */
export const OTP_TRAIL = ['otpInit', 'assertOtp'];

/** The portal hand-off and the SSO calls. */
export const PORTAL_TRAIL = ['logon', 'landing', 'landed', 'bootstrap', 'sessionToken'];

/**
 * The BFF reads of the one selected account: its movements twice. The oldest
 * synthetic row is newer than the window start, so the driver asks again up
 * to that row; the reply adds no older row and the round ends.
 */
export const SCRAPE_TRAIL = ['userData', 'accountType', 'balance', 'list', 'list'];

/** A run the bank asks no code of, end to end. */
export const COLD_TRAIL = [...OPENING_TRAIL, ...PORTAL_TRAIL, ...SCRAPE_TRAIL];

/** Every Transmit path: the key exchange, the login and the assertions. */
const TRANSMIT_PATHS: readonly string[] = [
  WIRE_PATHS.keyExchange,
  WIRE_PATHS.login,
  WIRE_PATHS.assert,
];

/**
 * The device id each Transmit call named, in order.
 * @param run - The run.
 * @returns One `did` per Transmit call ('' when it named none).
 */
export function didsOf(run: IBeinleumiRun): readonly string[] {
  const urls = run.calls.map(call => new URL(call.url));
  const transmit = urls.filter(url => TRANSMIT_PATHS.includes(url.pathname));
  return transmit.map(url => url.searchParams.get('did') ?? '');
}

/**
 * The persistence a run supplies: the stored state, and the callback.
 * @param setup - The run setup.
 * @param published - Receives each state the callback records.
 * @returns The persistence slots.
 */
function persistenceOf(setup: IRunSetup, published: string[]): PersistSlot {
  const callback = callbackOf(setup.callback ?? false, published);
  const did = setup.storedDid ?? '';
  if (did === '') return callback;
  const owner = ownerOf(setup.stateBrand ?? setup.brand, setup.stateAccount);
  const persistentAuthState = storedState(did, owner);
  return { ...callback, persistentAuthState };
}

/**
 * The credentials and options a run is created with.
 * @param setup - The run setup.
 * @param retriever - The run's retriever slot.
 * @param persistence - The run's persistence slots.
 * @returns The credentials and options.
 */
function inputsOf(
  setup: IRunSetup,
  retriever: RetrieverSlot,
  persistence: PersistSlot,
): { creds: ScraperCredentials; options: ScraperOptions } {
  const options = {
    companyId: (setup.brand ?? BEINLEUMI_MOCK_BRAND).companyId,
    startDate: BEINLEUMI_MOCK_START_DATE,
    ...persistence,
  };
  const base = { ...BEINLEUMI_MOCK_CREDS, ...setup.creds };
  if (setup.retrieverIn === 'options')
    return { creds: base, options: { ...options, ...retriever } };
  return { creds: { ...base, ...retriever }, options };
}

/**
 * Scrape the synthetic bank once.
 * @param fault - How the bank misbehaves.
 * @param setup - Credential overrides, the retriever and the stored state.
 * @returns What the run sent, received, asked for and published.
 */
export async function runBeinleumi(
  fault: BeinleumiFault = 'none',
  setup: IRunSetup = {},
): Promise<IBeinleumiRun> {
  const hints: string[] = [];
  const published: string[] = [];
  const retriever = retrieverOf(setup.otp ?? BN_OTP, hints);
  const persistence = persistenceOf(setup, published);
  const { creds, options } = inputsOf(setup, retriever, persistence);
  const stored = persistence.persistentAuthState ?? '';
  const state = freshState(fault, setup.storedDid ?? '', setup.brand);
  const handle = installBeinleumiFetchMock(state);
  try {
    const result = await createScraper(options).scrape(creds);
    const calls = handle.calls();
    return { result, calls, trail: state.trail, state, hints, published, stored };
  } finally {
    handle.dispose();
  }
}
