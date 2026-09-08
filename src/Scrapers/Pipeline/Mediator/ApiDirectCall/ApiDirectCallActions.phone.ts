/**
 * Phone-number wire-format normalisation for the ApiDirectCall ACTION stage.
 * PII-safe: only logs shape descriptors (length, leading digits), never raw digits.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';
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
 * Refuse a phone the bank's wire format cannot represent.
 *
 * <p>This used to warn and hand the raw value on, on the stated grounds
 * that something downstream would validate it. Nothing does. Pepper reads
 * `credentials.phoneNumber` straight into its `x-user-id` header, so a
 * local-form number such as `05XXXXXXXX` — the form a user is most likely
 * to supply — went to the bank verbatim and came back as an opaque auth
 * failure naming nothing (issue #552).
 * @param bundle - Original normalisation bundle.
 * @param reason - Failure reason from {@link formatPhoneNumber}.
 * @returns Failed Procedure carrying a PII-safe diagnostic.
 */
function failUnusablePhone(bundle: INormaliseBundle, reason: string): Procedure<IPipelineContext> {
  const { ctx, format, rawShape } = bundle;
  const message = `phoneNumber cannot be normalised to the ${format} wire format: ${reason}`;
  ctx.logger.error({ module: PHASE_LABEL, format, rawShape }, message);
  return fail(ScraperErrorTypes.InvalidPhoneNumber, message);
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
 * @returns Updated ctx, or a failure when the phone is unusable.
 */
function applyWireOutcome(bundle: INormaliseBundle): Procedure<IPipelineContext> {
  const wire = formatPhoneNumber(bundle.raw, bundle.format);
  if (!isOk(wire)) return failUnusablePhone(bundle, wire.errorMessage);
  const next = applyWireFormat(bundle, wire.value);
  return succeed(next);
}

/**
 * Rewrite `ctx.credentials.phoneNumber` into the bank's wire format.
 *
 * <p>A bank that declares no `phoneNumberFormat`, or a context carrying no
 * `phoneNumber`, has nothing to normalise and passes through untouched. A
 * bank that does declare one gets a value in that format or no run at all.
 * @param ctx - Pipeline context.
 * @returns Ctx with credentials.phoneNumber normalised, or a failure.
 */
function withNormalisedCreds(ctx: IPipelineContext): Procedure<IPipelineContext> {
  const bundle = collectNormaliseBundle(ctx);
  if (bundle === false) return succeed(ctx);
  return applyWireOutcome(bundle);
}

export default withNormalisedCreds;

export { withNormalisedCreds };
