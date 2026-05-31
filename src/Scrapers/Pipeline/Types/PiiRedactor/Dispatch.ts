/**
 * PiiRedactor / Dispatch — strategy registry + Pino censor factory.
 *
 * Extracted from `Facade.ts` in Phase 8.5c / C1 (split). Owns the
 * per-category strategy lookup table, the value-coercion helpers,
 * the per-call dispatcher with error-swallowing, and the
 * `createCensorFn()` factory consumed by Pino. No knowledge of path
 * routing — that lives in `Routing.ts`. No knowledge of the
 * unified `redact()` entry point — that lives in `Facade.ts`.
 *
 * Spec: pipeline-decoupling-master-2026-05-28 / phase-6 / spec.txt §3.
 */

import { redactAccount } from './Account.js';
import { redactAmount } from './Amount.js';
import { redactCookie, redactOtp, redactToken } from './AuthCredentials.js';
import { redactCard } from './Card.js';
import { redactIsraeliId } from './IsraeliId.js';
import { redactMerchant } from './Merchant.js';
import { redactName } from './Name.js';
import { redactPhone } from './Phone.js';
import { classifyKey } from './Routing.js';
import {
  type PiiCategory,
  type PiiHintString,
  REDACTED_HINT,
  REDACTION_ERROR_HINT,
} from './Types.js';

/** Pino's redact callback value type — strings, numbers, or booleans. */
export type CensorValue = string | number | boolean;

/** Pino's redact callback signature — value+path → string. */
export type CensorFn = (value: CensorValue, path: readonly string[]) => string;

/** String-strategy lookup table (excludes amount which has number input). */
const STRING_STRATEGIES: Readonly<Partial<Record<PiiCategory, (value: string) => string>>> = {
  account: redactAccount,
  card: redactCard,
  israeliId: redactIsraeliId,
  phone: redactPhone,
  name: redactName,
  merchant: redactMerchant,
  token: redactToken,
  otp: redactOtp,
  cookie: redactCookie,
};

/** Args bundle for dispatchStrategy — keeps the function signature typed. */
interface IDispatchArgs {
  readonly value: CensorValue;
  readonly category: PiiCategory;
}

/**
 * Coerce a censor input to its string form for lookup-table dispatch.
 * @param value - Pino value (string | number | boolean).
 * @returns String coercion.
 */
function toStringValue(value: CensorValue): PiiHintString {
  if (typeof value === 'string') return value as PiiHintString;
  return String(value) as PiiHintString;
}

/**
 * Coerce a censor input to a number-or-string for redactAmount.
 * @param value - Pino value.
 * @returns Number when value is number, else its string form.
 */
function toAmountValue(value: CensorValue): number | string {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return String(value);
  return value;
}

/**
 * Dispatch a single value+category pair to the matching strategy.
 * @param args - Bundled value + category.
 * @returns Stable hint.
 */
function dispatchStrategy(args: IDispatchArgs): PiiHintString {
  if (args.category === 'amount') {
    const amountInput = toAmountValue(args.value);
    return redactAmount(amountInput);
  }
  const strategy = STRING_STRATEGIES[args.category];
  if (strategy === undefined) return REDACTED_HINT as PiiHintString;
  const stringInput = toStringValue(args.value);
  return strategy(stringInput) as PiiHintString;
}

/**
 * Classify + dispatch a single censor invocation. Strategy throws are
 * translated to {@link REDACTION_ERROR_HINT} so the censor caller
 * never propagates internal errors back to pino.
 * @param value - Value being censored.
 * @param tail - Non-empty path tail (last key).
 * @returns Stable hint string.
 */
function censorTail(value: CensorValue, tail: string): PiiHintString {
  try {
    return dispatchStrategy({ value, category: classifyKey(tail) });
  } catch {
    return REDACTION_ERROR_HINT as PiiHintString;
  }
}

/**
 * Pino redact callback factory. Each invocation classifies the path
 * tail, dispatches to a strategy, and returns the stable hint string.
 * Strategy throws are caught and translated to '[REDACTION_ERROR]'.
 * @returns Censor function bound to the production strategy table.
 */
export function createCensorFn(): CensorFn {
  return (value, path): PiiHintString => {
    if (path.length === 0) return REDACTED_HINT as PiiHintString;
    const tail = path.at(-1);
    if (tail === undefined || tail.length === 0) return REDACTED_HINT as PiiHintString;
    return censorTail(value, tail);
  };
}
