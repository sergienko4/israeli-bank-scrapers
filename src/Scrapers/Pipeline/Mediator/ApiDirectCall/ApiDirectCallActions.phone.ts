/**
 * Phone-number wire-format normalisation for the ApiDirectCall ACTION stage.
 * PII-safe: only logs shape descriptors (length, leading digits), never raw digits.
 */

import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { PhoneNumberFormat } from '../Credentials/PhoneFormatter.js';
import { formatPhoneNumber } from '../Credentials/PhoneFormatter.js';
import { PHASE_LABEL } from './ApiDirectCallActions.shared.js';

/**
 * PII-safe shape descriptor for a phone string.
 * @param raw - Raw phone string.
 * @returns Structure descriptor object.
 */
function phoneShape(raw: string): Readonly<Record<string, unknown>> {
  return {
    len: raw.length,
    startsWith972: raw.startsWith('972'),
    hasDash: raw.includes('-'),
    hasPlus: raw.includes('+'),
    hasSpace: raw.includes(' '),
    leadingZero: raw.startsWith('0'),
  };
}

/** Bundle assembled when wire normalisation has actionable input. */
interface INormaliseBundle {
  readonly ctx: IPipelineContext;
  readonly raw: string;
  readonly format: PhoneNumberFormat;
  readonly rawShape: ReturnType<typeof phoneShape>;
}

/**
 * Read the per-bank wire format AND the raw phoneNumber from ctx.
 * @param ctx - Pipeline context.
 * @returns Normalisation bundle, or `false` when no work is required.
 */
function collectNormaliseBundle(ctx: IPipelineContext): INormaliseBundle | false {
  const config = ctx.config;
  if (!('headless' in config) || !config.headless) return false;
  const format = config.headless.phoneNumberFormat;
  if (format === undefined) return false;
  const creds = ctx.credentials as unknown as Record<string, unknown>;
  const raw = creds.phoneNumber;
  if (typeof raw !== 'string') return false;
  return { ctx, raw, format, rawShape: phoneShape(raw) };
}

/**
 * Log + return ctx unchanged when wire formatting fails.
 * @param bundle - Original normalisation bundle.
 * @param reason - Failure reason from {@link formatPhoneNumber}.
 * @returns Ctx unchanged.
 */
function logFormatFailure(bundle: INormaliseBundle, reason: string): IPipelineContext {
  const { ctx, format, rawShape } = bundle;
  ctx.logger.warn(
    { module: PHASE_LABEL, reason, format, rawShape },
    'phoneNumber normalisation failed — keeping raw input for downstream validation',
  );
  return ctx;
}

/**
 * Apply a successful wire-format value back onto ctx.credentials.
 * @param bundle - Original normalisation bundle.
 * @param wireValue - Wire-format string from {@link formatPhoneNumber}.
 * @returns New ctx with credentials.phoneNumber set to wireValue.
 */
function applyWireFormat(bundle: INormaliseBundle, wireValue: string): IPipelineContext {
  const { ctx, format, rawShape } = bundle;
  const wireShape = phoneShape(wireValue);
  const msg = 'phoneNumber normalised (PII-safe shape only)';
  ctx.logger.info({ module: PHASE_LABEL, format, rawShape, wireShape }, msg);
  const credsBag = ctx.credentials as unknown as Record<string, unknown>;
  const next = { ...credsBag, phoneNumber: wireValue };
  const credentials = next as unknown as IPipelineContext['credentials'];
  return { ...ctx, credentials };
}

/**
 * Apply the wire-format Procedure outcome to the bundle's ctx.
 * @param bundle - Normalisation bundle.
 * @returns Updated ctx (success) or original ctx (failure).
 */
function applyWireOutcome(bundle: INormaliseBundle): IPipelineContext {
  const wire = formatPhoneNumber(bundle.raw, bundle.format);
  if (!wire.success) return logFormatFailure(bundle, wire.errorMessage);
  return applyWireFormat(bundle, wire.value);
}

/**
 * Rewrite `ctx.credentials.phoneNumber` into the bank's wire format.
 * @param ctx - Pipeline context.
 * @returns Ctx with credentials.phoneNumber normalised, or unchanged.
 */
function withNormalisedCreds(ctx: IPipelineContext): IPipelineContext {
  const bundle = collectNormaliseBundle(ctx);
  if (bundle === false) return ctx;
  return applyWireOutcome(bundle);
}

export default withNormalisedCreds;

export { withNormalisedCreds };
