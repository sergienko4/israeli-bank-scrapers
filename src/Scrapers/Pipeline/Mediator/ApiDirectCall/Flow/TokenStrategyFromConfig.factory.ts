/**
 * Strategy factory: assembles the 5 bindings exposed by IConfigTokenStrategy
 * and wires them into createTokenStrategyFromConfig.
 */

import type { Procedure } from '../../../Types/Procedure.js';
import { isOk, succeed } from '../../../Types/Procedure.js';
import type { JsonValue } from '../Envelope/JsonPointer.js';
import type { IApiDirectCallConfig } from '../IApiDirectCallConfig.js';
import {
  hasWarmStateImpl,
  primeFreshImpl,
  primeInitialImpl,
} from './TokenStrategyFromConfig.flow.js';
import { gateFlowKind, STRATEGY_NAME_DEFAULT } from './TokenStrategyFromConfig.shared.js';
import type {
  IConfigTokenStrategy,
  ICreateTokenStrategyArgs,
  ILongTermTokenSlot,
  IStrategyBindings,
} from './TokenStrategyFromConfig.types.js';

/**
 * primeInitial factory — captures (config, slot) for the dispatch.
 * @param config - Bank config.
 * @param slot - Mutable capture slot.
 * @returns Strategy primeInitial binding.
 */
function makePrimeInitial(
  config: IApiDirectCallConfig,
  slot: ILongTermTokenSlot,
): IConfigTokenStrategy['primeInitial'] {
  return (bus, ctx, creds): Promise<Procedure<string>> =>
    primeInitialImpl({ config, bus, ctx, creds, slot });
}

/**
 * primeFresh factory — captures (config, slot) for the dispatch.
 * @param config - Bank config.
 * @param slot - Mutable capture slot.
 * @returns Strategy primeFresh binding.
 */
function makePrimeFresh(
  config: IApiDirectCallConfig,
  slot: ILongTermTokenSlot,
): IConfigTokenStrategy['primeFresh'] {
  return (bus, ctx, creds): Promise<Procedure<string>> =>
    primeFreshImpl({ config, bus, ctx, creds, slot });
}

/**
 * hasWarmState factory — wraps hasWarmStateImpl with captured config.
 * @param config - Bank config.
 * @returns Strategy hasWarmState binding.
 */
function makeHasWarmState(config: IApiDirectCallConfig): IConfigTokenStrategy['hasWarmState'] {
  return (creds): boolean => hasWarmStateImpl(config, creds);
}

/**
 * Build the prime-side bindings (initial + fresh + hasWarmState).
 * @param config - Bank config.
 * @param slot - Capture slot.
 * @returns Three-binding object.
 */
function buildPrimeBindings(
  config: IApiDirectCallConfig,
  slot: ILongTermTokenSlot,
): Pick<IStrategyBindings, 'primeInitial' | 'primeFresh' | 'hasWarmState'> {
  return {
    primeInitial: makePrimeInitial(config, slot),
    primeFresh: makePrimeFresh(config, slot),
    hasWarmState: makeHasWarmState(config),
  };
}

/**
 * Build the slot-getter bindings (long-term token + carry snapshot).
 * @param slot - Capture slot.
 * @returns Two-binding object.
 */
function buildGetterBindings(
  slot: ILongTermTokenSlot,
): Pick<IStrategyBindings, 'getLatestLongTermToken' | 'getLatestCarrySnapshot'> {
  /**
   * Read the captured long-term token from the slot.
   * @returns Latest captured token (or '' when none).
   */
  const getLatestLongTermToken = (): string => slot.latest;
  /**
   * Read the captured carry snapshot from the slot.
   * @returns Latest captured carry snapshot.
   */
  const getLatestCarrySnapshot = (): Readonly<Record<string, JsonValue>> =>
    slot.latestCarrySnapshot;
  return { getLatestLongTermToken, getLatestCarrySnapshot };
}

/**
 * Build the 5 bindings exposed by IConfigTokenStrategy.
 * @param config - Bank config.
 * @param slot - Mutable capture slot.
 * @returns Strategy bindings (no name field).
 */
function buildStrategyBindings(
  config: IApiDirectCallConfig,
  slot: ILongTermTokenSlot,
): IStrategyBindings {
  return { ...buildPrimeBindings(config, slot), ...buildGetterBindings(slot) };
}

/**
 * Assemble the strategy instance from gated config.
 * @param args - Validated factory args.
 * @returns Strategy procedure.
 */
function assembleStrategy(args: ICreateTokenStrategyArgs): Procedure<IConfigTokenStrategy> {
  const { config } = args;
  const name = args.name ?? STRATEGY_NAME_DEFAULT;
  const slot: ILongTermTokenSlot = { latest: '', latestCarrySnapshot: Object.freeze({}) };
  const bindings = buildStrategyBindings(config, slot);
  return succeed({ name, ...bindings });
}

/**
 * Factory — build the config-driven token strategy.
 * @param args - Factory args (config + optional name).
 * @returns Procedure with the strategy instance, or unsupported-flow fail.
 */
function createTokenStrategyFromConfig(
  args: ICreateTokenStrategyArgs,
): Procedure<IConfigTokenStrategy> {
  const gate = gateFlowKind(args.config);
  if (!isOk(gate)) return gate;
  return assembleStrategy(args);
}

export default createTokenStrategyFromConfig;

export { createTokenStrategyFromConfig };
