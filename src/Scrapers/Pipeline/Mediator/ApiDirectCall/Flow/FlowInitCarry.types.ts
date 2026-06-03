/**
 * Shared types + private alias used across the FlowInitCarry cluster.
 */

import type { Procedure } from '../../../Types/Procedure.js';
import type { JsonValue } from '../Envelope/JsonPointer.js';
import type {
  IApiDirectCallConfig,
  IDerivedCarry,
  ISeedCarrySource,
  RefToken,
  SeedCarryBootstrapKind,
} from '../IApiDirectCallConfig.js';

/** Mutable carry accumulator used while flow-init runs. */
type CarryMut = Record<string, JsonValue>;

/** Bare creds-credential alias used by all helpers. */
type Creds = Readonly<Record<string, unknown>>;

/** One seed-source entry can be a bare field name or a full source spec. */
type SeedSourceEntry = string | ISeedCarrySource;

/** Args bundle for `bootstrapJwtClaim` — preserves the 3-param ceiling. */
interface IJwtClaimArgs {
  readonly from: string;
  readonly claim: string;
  readonly optional: boolean;
  readonly creds: Creds;
}

/** Args bundle for `resolveDerivedPart` — keeps params ≤3. */
interface IResolveDerivedPartArgs {
  readonly part: RefToken;
  readonly creds: Creds;
  readonly config: IApiDirectCallConfig;
  readonly carry: Readonly<CarryMut>;
}

/** Args bundle for `evalDerivedCarry` — respects the 3-param ceiling. */
interface IEvalDerivedArgs {
  readonly derived: IDerivedCarry;
  readonly creds: Creds;
  readonly config: IApiDirectCallConfig;
  readonly carry: Readonly<CarryMut>;
}

/** Walk context for `stepJsonPath`. */
interface IWalkJsonCtx {
  readonly path: string;
}

/** Args bundle for `stepJsonPath` — cursor + segment + walk context. */
interface IStepJsonPathArgs {
  readonly acc: Procedure<unknown>;
  readonly segment: string;
  readonly ctx: IWalkJsonCtx;
}

/** Args bundle for `makeJwtClaimArgs` — bootstrap descriptor + creds. */
interface IMakeJwtClaimArgs {
  readonly bootstrap: Extract<SeedCarryBootstrapKind, { kind: 'jwt-claim' }>;
  readonly creds: Creds;
}

/** Shared context across derivedCarry entries — creds + config + carry. */
interface IDerivationSharedCtx {
  readonly creds: Creds;
  readonly config: IApiDirectCallConfig;
  readonly carry: CarryMut;
}

/** Args bundle for `walkConfigPath` — keeps the helper short. */
interface IWalkConfigArgs {
  readonly cursor: unknown;
  readonly segments: readonly string[];
  readonly dotted: string;
}

/** Bundle for `reduceConfigPath` — one segment + the full dotted path. */
interface IReduceConfigPathCtx {
  readonly segment: string;
  readonly dotted: string;
}

/** Single prefix→resolver rule for the derived-part dispatch. */
interface IPartRule {
  readonly prefix: string;
  readonly resolve: (rest: string, args: IResolveDerivedPartArgs) => unknown;
}

/** Bundle for `reduceSeed` — carries the loop's stable context. */
interface IReduceSeedCtx {
  readonly entry: SeedSourceEntry;
  readonly creds: Creds;
  readonly carry: CarryMut;
}

/** Bundle for `reduceDerivedPart` — one part RefToken + eval context. */
interface IReduceDerivedPartCtx {
  readonly part: RefToken;
  readonly evalCtx: IEvalDerivedArgs;
}

/** Bundle for `reduceDerivation` — one derivation + eval context. */
interface IReduceDerivationCtx {
  readonly derived: IDerivedCarry;
  readonly evalCtx: IEvalDerivedArgs;
}

/** Re-export of the public bootstrap kind for sibling consumers. */
export type {
  CarryMut,
  Creds,
  IApiDirectCallConfig,
  IDerivationSharedCtx,
  IEvalDerivedArgs,
  IJwtClaimArgs,
  IMakeJwtClaimArgs,
  IPartRule,
  IReduceConfigPathCtx,
  IReduceDerivationCtx,
  IReduceDerivedPartCtx,
  IReduceSeedCtx,
  IResolveDerivedPartArgs,
  IStepJsonPathArgs,
  IWalkConfigArgs,
  IWalkJsonCtx,
  SeedCarryBootstrapKind,
  SeedSourceEntry,
};
