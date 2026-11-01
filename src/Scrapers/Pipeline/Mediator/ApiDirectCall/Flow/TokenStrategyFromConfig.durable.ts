/**
 * Durable prime dispatch — one primer per persistent-auth `kind`. Adding a
 * kind adds a primer here; no caller branches on the kind.
 */

import type { Procedure } from '../../../Types/Procedure.js';
import type { PersistentAuthKind } from '../ConfigContracts/index.js';
import { primeDeviceMemory } from './TokenStrategyFromConfig.deviceMemory.js';
import { primeBoundDevice } from './TokenStrategyFromConfig.persistent.js';
import type {
  DurableAuthMode,
  IDurablePrimeArgs,
  IPrimeArgs,
  RunConfiguredFlow,
} from './TokenStrategyFromConfig.types.js';

/** Every kind's primer, each typed to its own narrowed block. */
type PersistentPrimers = {
  readonly [TKind in PersistentAuthKind]: (
    args: IDurablePrimeArgs<TKind>,
  ) => Promise<Procedure<string>>;
};

const PERSISTENT_PRIMERS: PersistentPrimers = {
  'bound-device': primeBoundDevice,
  'device-memory': primeDeviceMemory,
};

/**
 * Whether a kind has a primer — the build rule's single source of truth.
 * @param kind - Configured persistent-auth kind.
 * @returns True for a supported kind.
 */
function isPersistentAuthKind(kind: string): boolean {
  return Object.hasOwn(PERSISTENT_PRIMERS, kind);
}

/**
 * Run the primer of one kind with its narrowed args.
 * @param kind - The block's kind.
 * @param args - Prime args narrowed to that kind.
 * @returns Formatted Authorization header value.
 */
async function runPrimer<TKind extends PersistentAuthKind>(
  kind: TKind,
  args: IDurablePrimeArgs<TKind>,
): Promise<Procedure<string>> {
  const primer = PERSISTENT_PRIMERS[kind];
  return primer(args);
}

/**
 * primeInitial for a durable strategy — picks the primer by the block's kind.
 * @param prime - Strategy prime args.
 * @param mode - Durable mode the strategy was built for.
 * @param runFlow - The legacy flow runner, for primers that reuse it.
 * @returns Formatted Authorization header value.
 */
async function primeDurable(
  prime: IPrimeArgs,
  mode: DurableAuthMode,
  runFlow: RunConfiguredFlow,
): Promise<Procedure<string>> {
  const { block } = mode;
  return runPrimer(block.kind, { prime, mode, block, runFlow });
}

export { isPersistentAuthKind, primeDurable };
