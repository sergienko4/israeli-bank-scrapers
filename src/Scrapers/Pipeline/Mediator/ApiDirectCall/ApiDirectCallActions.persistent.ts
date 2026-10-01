/**
 * Durable device-auth mode resolution for the ApiDirectCall phase.
 *
 * <p>Pure: picks one mode from the bank config, the lifted persistent-auth
 * options and the merged credentials, before any auth request. A bank whose
 * config declares no persistent-auth block always stays legacy, whatever
 * options it was handed. Failures name a category only — the options carry a
 * bearer token, a device private key and a storage callback.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type {
  IPersistentAuthInput,
  PersistentAuthStateCallback,
} from '../../Types/Domain/PersistentAuthInput.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { IApiDirectCallConfig, IPersistentAuthConfig } from './ConfigContracts/index.js';
import type { GenericCreds, PersistentAuthMode } from './Flow/TokenStrategyFromConfig.js';

/** Presence facts the option rules read — never the option values. */
interface IOptionFacts {
  readonly isMalformed: boolean;
  readonly hasState: boolean;
  readonly hasCallback: boolean;
  readonly hasLegacyToken: boolean;
}

/** One invalid option combination and the category it fails with. */
interface IOptionRule {
  readonly category: string;
  readonly isViolated: (facts: IOptionFacts) => boolean;
}

/** Inputs a durable mode is built from once every rule has passed. */
interface IDurableArgs {
  readonly block: IPersistentAuthConfig;
  readonly input: IPersistentAuthInput;
  readonly creds: GenericCreds;
}

/** The single legacy verdict — no durable behaviour at all. */
const LEGACY_MODE: PersistentAuthMode = { kind: 'legacy' };

/**
 * Whether either option arrived with the wrong runtime type.
 * @param facts - Presence facts.
 * @returns True when the input is unusable.
 */
function isMalformedInput(facts: IOptionFacts): boolean {
  return facts.isMalformed;
}

/**
 * Whether stored state was combined with the legacy long-term token.
 * @param facts - Presence facts.
 * @returns True for the conflicting combination.
 */
function hasStateWithLegacyToken(facts: IOptionFacts): boolean {
  return facts.hasState && facts.hasLegacyToken;
}

/**
 * Whether a durable callback was combined with the legacy long-term token.
 * Moving an account from one store to the other must be explicit.
 * @param facts - Presence facts.
 * @returns True for the conflicting combination.
 */
function hasCallbackWithLegacyToken(facts: IOptionFacts): boolean {
  return facts.hasCallback && facts.hasLegacyToken;
}

/**
 * Whether stored state arrived without the callback that must persist its
 * replacement.
 * @param facts - Presence facts.
 * @returns True for the incomplete combination.
 */
function hasStateWithoutCallback(facts: IOptionFacts): boolean {
  return facts.hasState && !facts.hasCallback;
}

/** Invalid combinations from the approved mode table, checked in order. */
const OPTION_RULES: readonly IOptionRule[] = [
  { category: 'malformed', isViolated: isMalformedInput },
  { category: 'state-with-legacy-token', isViolated: hasStateWithLegacyToken },
  { category: 'callback-with-legacy-token', isViolated: hasCallbackWithLegacyToken },
  { category: 'state-without-callback', isViolated: hasStateWithoutCallback },
];

/**
 * Read a credential as text; any other type counts as absent.
 * @param creds - Merged credentials.
 * @param field - Credential field name.
 * @returns The string value, or '' when absent.
 */
function readCredText(creds: GenericCreds, field: string): string {
  const value = creds[field];
  return typeof value === 'string' ? value : '';
}

/**
 * Whether the caller also supplied the bank's legacy long-term token.
 * @param config - API-direct-call config.
 * @param creds - Merged credentials.
 * @returns True when the warm-start credential holds a non-empty string.
 */
function hasLegacyToken(config: IApiDirectCallConfig, creds: GenericCreds): boolean {
  const field = config.warmStart?.credsField;
  if (field === undefined) return false;
  return readCredText(creds, field).length > 0;
}

/**
 * Reduce the input to the presence facts the rules read.
 * @param input - Lifted persistent-auth options.
 * @param hasToken - Whether the legacy token is present.
 * @returns Presence facts.
 */
function collectFacts(input: IPersistentAuthInput, hasToken: boolean): IOptionFacts {
  const hasState = input.state.has;
  const hasCallback = input.onUpdate.has;
  return { isMalformed: input.isMalformed, hasState, hasCallback, hasLegacyToken: hasToken };
}

/**
 * Build the durable mode: enrollment without state, resume with it.
 * @param args - Validated durable inputs.
 * @param onUpdate - The caller's storage callback.
 * @returns Enrollment or resume mode.
 */
function buildDurableMode(
  args: IDurableArgs,
  onUpdate: PersistentAuthStateCallback,
): PersistentAuthMode {
  const account = readCredText(args.creds, args.block.accountField);
  const base = { block: args.block, onUpdate, account };
  const { state } = args.input;
  if (!state.has) return { kind: 'enroll', ...base };
  return { kind: 'resume', ...base, encodedState: state.value };
}

/**
 * Pick the mode for a valid combination; no callback means no durable mode.
 * @param args - Validated durable inputs.
 * @returns Resolved mode.
 */
function pickValidMode(args: IDurableArgs): PersistentAuthMode {
  const { onUpdate } = args.input;
  if (!onUpdate.has) return LEGACY_MODE;
  return buildDurableMode(args, onUpdate.value);
}

/**
 * Apply the option rules, then pick the mode.
 * @param args - Durable inputs for a bank with a persistent-auth block.
 * @param hasToken - Whether the legacy token is present.
 * @returns Resolved mode, or a category-only failure.
 */
function resolveForBlock(args: IDurableArgs, hasToken: boolean): Procedure<PersistentAuthMode> {
  const facts = collectFacts(args.input, hasToken);
  const broken = OPTION_RULES.find((rule): boolean => rule.isViolated(facts));
  if (broken !== undefined) {
    return fail(ScraperErrorTypes.Generic, `persistent auth options invalid: ${broken.category}`);
  }
  const mode = pickValidMode(args);
  return succeed(mode);
}

/**
 * Resolve the durable device-auth mode. Runs no request.
 * @param config - API-direct-call config.
 * @param input - Lifted persistent-auth options.
 * @param creds - Merged credentials, phone already normalised.
 * @returns Resolved mode, or a category-only failure for an invalid combination.
 */
function resolvePersistentAuthMode(
  config: IApiDirectCallConfig,
  input: IPersistentAuthInput,
  creds: GenericCreds,
): Procedure<PersistentAuthMode> {
  const block = config.persistentAuth;
  if (block === undefined) return succeed(LEGACY_MODE);
  const hasToken = hasLegacyToken(config, creds);
  return resolveForBlock({ block, input, creds }, hasToken);
}

export default resolvePersistentAuthMode;

export { resolvePersistentAuthMode };
