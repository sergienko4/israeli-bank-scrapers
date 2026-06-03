/**
 * derivedCarry part resolvers — carry/creds/config lookups with
 * dotted-path walks for the `config` namespace.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { IApiDirectCallConfig } from '../IApiDirectCallConfig.js';
import type {
  CarryMut,
  Creds,
  IPartRule,
  IReduceConfigPathCtx,
  IResolveDerivedPartArgs,
  IWalkConfigArgs,
} from './FlowInitCarry.types.js';

/**
 * Stringify a carry slot lookup with a clear missing-slot diagnostic.
 * @param slot - Slot name.
 * @param carry - Carry accumulator.
 * @returns Procedure with the string value.
 */
function carryString(slot: string, carry: Readonly<CarryMut>): Procedure<string> {
  const value = carry[slot];
  if (typeof value !== 'string') {
    return fail(ScraperErrorTypes.Generic, `derivedCarry: carry.${slot} missing or non-string`);
  }
  return succeed(value);
}

/**
 * Stringify a creds-field lookup with a clear missing-field diagnostic.
 * @param field - Creds field name.
 * @param creds - Caller credentials.
 * @returns Procedure with the string value.
 */
function credsString(field: string, creds: Creds): Procedure<string> {
  const value = creds[field];
  if (typeof value !== 'string') {
    return fail(ScraperErrorTypes.Generic, `derivedCarry: creds.${field} missing or non-string`);
  }
  return succeed(value);
}

/**
 * Step the dotted-path walker one segment forward.
 * @param args - Walk bundle.
 * @returns Procedure with the next cursor.
 */
function stepConfigPath(args: IWalkConfigArgs): Procedure<unknown> {
  if (args.cursor === null || typeof args.cursor !== 'object') {
    return fail(ScraperErrorTypes.Generic, `derivedCarry: config.${args.dotted} miss`);
  }
  const head = args.segments[0];
  const child = (args.cursor as Record<string, unknown>)[head];
  return succeed(child);
}

/**
 * Reducer step for the config-path walker.
 * @param acc - Accumulator procedure (current cursor).
 * @param ctx - Bundle with dotted path + remaining-segments info.
 * @returns Updated cursor procedure.
 */
function reduceConfigPath(acc: Procedure<unknown>, ctx: IReduceConfigPathCtx): Procedure<unknown> {
  if (!isOk(acc)) return acc;
  return stepConfigPath({ cursor: acc.value, segments: [ctx.segment], dotted: ctx.dotted });
}

/**
 * Coerce a config-walker outcome to a string Procedure.
 * @param walked - Walker outcome.
 * @param dotted - Original dotted path (for diagnostics).
 * @returns Procedure with the string value.
 */
function coerceConfigWalked(walked: Procedure<unknown>, dotted: string): Procedure<string> {
  if (!isOk(walked)) return walked;
  if (typeof walked.value !== 'string') {
    return fail(ScraperErrorTypes.Generic, `derivedCarry: config.${dotted} non-string`);
  }
  return succeed(walked.value);
}

/**
 * Walk a dotted path through `config` and stringify the leaf.
 * @param dotted - Dotted path like `secrets.signKey`.
 * @param config - API-direct-call config.
 * @returns Procedure with the string value.
 */
function configString(dotted: string, config: IApiDirectCallConfig): Procedure<string> {
  const segments = dotted.split('.');
  const seed: Procedure<unknown> = succeed(config);
  const walked = segments.reduce<Procedure<unknown>>(
    (acc, segment) => reduceConfigPath(acc, { segment, dotted }),
    seed,
  );
  return coerceConfigWalked(walked, dotted);
}

/**
 * Resolve a `carry.<slot>` derived part.
 * @param rest - Slot name after the `carry.` prefix.
 * @param args - Resolver args bundle.
 * @returns Procedure with the string value.
 */
function resolveCarryPart(rest: string, args: IResolveDerivedPartArgs): Procedure<string> {
  return carryString(rest, args.carry);
}

/**
 * Resolve a `creds.<field>` derived part.
 * @param rest - Creds field after the `creds.` prefix.
 * @param args - Resolver args bundle.
 * @returns Procedure with the string value.
 */
function resolveCredsPart(rest: string, args: IResolveDerivedPartArgs): Procedure<string> {
  return credsString(rest, args.creds);
}

/**
 * Resolve a `config.<path>` derived part.
 * @param rest - Dotted path after the `config.` prefix.
 * @param args - Resolver args bundle.
 * @returns Procedure with the string value.
 */
function resolveConfigPart(rest: string, args: IResolveDerivedPartArgs): Procedure<string> {
  return configString(rest, args.config);
}

/** Dispatch table mapping RefToken prefixes to their resolvers. */
const PART_RULES: readonly IPartRule[] = [
  { prefix: 'carry.', resolve: resolveCarryPart },
  { prefix: 'creds.', resolve: resolveCredsPart },
  { prefix: 'config.', resolve: resolveConfigPart },
];

/**
 * Resolve a single `IDerivedCarry` part — RefToken targeting
 * `carry.<slot>`, `creds.<field>`, or `config.<dotted.path>`.
 * @param args - Bundle (part + creds + config + carry).
 * @returns Procedure with the part value as string.
 */
function resolveDerivedPart(args: IResolveDerivedPartArgs): Procedure<string> {
  const part = args.part;
  const rule = PART_RULES.find((candidate): boolean => part.startsWith(candidate.prefix));
  if (rule === undefined) {
    return fail(ScraperErrorTypes.Generic, `derivedCarry part not supported: ${part as string}`);
  }
  const rest = part.slice(rule.prefix.length);
  return rule.resolve(rest, args) as Procedure<string>;
}

export { carryString, configString, credsString, resolveDerivedPart };
