/**
 * Step envelope codec (N39, N52) — seal a POST step's prepared body after its
 * form guard, and open its answer before its bank-error guard (N20), outcome
 * or extracts read it: they then see `{ headers, data }`, the original headers
 * and the opened data. `CODEC_MODES` holds one seal and one open per codec
 * mode. A codec step's answer must come back sealed: a plaintext answer with
 * a non-zero numeric `error_code` is a bank error, any other an invalid
 * envelope. Failures name the step, never a key, IV or plaintext.
 */

import type { JsonValue } from '../../../Types/JsonValue.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { isOk, succeed } from '../../../Types/Procedure.js';
import type { EnvelopeCodec } from '../ConfigContracts/index.js';
import { checkExchangeKey, openExchangeAnswer } from './RunStep.codec.exchange.js';
import { hasBankErrorCode, type IOpenedAnswer, stepFail } from './RunStep.codec.open.js';
import { openSealedAnswer, sealSealedBody } from './RunStep.codec.sealed.js';
import { bankErrorOf, guardBankError } from './RunStep.failIfPresent.js';
import { guardFormBody } from './RunStep.form.js';
import type { IDispatchBundle, IPreparedBody, IStepConfig } from './RunStep.types.js';

/** A codec mode name. */
type EnvelopeMode = EnvelopeCodec['mode'];

/** The codec config of one mode. */
type CodecOf<TMode extends EnvelopeMode> = Extract<EnvelopeCodec, { readonly mode: TMode }>;

/** How one codec mode seals a body and opens an answer. */
interface ICodecMode<TCodec extends EnvelopeCodec> {
  readonly seal: (codec: TCodec, prepared: IPreparedBody) => Procedure<IPreparedBody>;
  readonly open: (
    bundle: IDispatchBundle,
    codec: TCodec,
    resp: JsonValue,
  ) => Procedure<IOpenedAnswer>;
}

/** One seal and one open per mode, each taking its own config. */
type CodecModes = { readonly [TMode in EnvelopeMode]: ICodecMode<CodecOf<TMode>> };

/** The codec modes — a new mode is one row. */
const CODEC_MODES: CodecModes = {
  sealed: { seal: sealSealedBody, open: openSealedAnswer },
  exchange: { seal: checkExchangeKey, open: openExchangeAnswer },
};

/**
 * The seal and open of a codec's mode.
 * @param codec - Codec config.
 * @returns The mode's seal and open.
 */
function modeOf<TMode extends EnvelopeMode>(codec: CodecOf<TMode>): ICodecMode<CodecOf<TMode>> {
  const mode: TMode = codec.mode;
  return CODEC_MODES[mode];
}

/**
 * Seal the prepared body with the step's codec mode.
 * @param step - Step config.
 * @param prepared - Guarded body and scope.
 * @returns The body ready to send, or `<step> envelope …` failure.
 */
function sealStepBody(step: IStepConfig, prepared: IPreparedBody): Procedure<IPreparedBody> {
  const codec = step.codec;
  if (codec === undefined) return succeed(prepared);
  const sealed = modeOf(codec).seal(codec, prepared);
  if (isOk(sealed)) return sealed;
  return stepFail(step, sealed.errorMessage);
}

/**
 * Guard a form body, then seal the envelope when the step names a codec.
 * @param step - Step config.
 * @param prepared - Signed body and scope.
 * @returns The body ready to send, or the first failure.
 */
function sealGuardedBody(step: IStepConfig, prepared: IPreparedBody): Procedure<IPreparedBody> {
  const guarded = guardFormBody(step, prepared);
  if (!isOk(guarded)) return guarded;
  return sealStepBody(step, guarded.value);
}

/**
 * Open a codec step's answer; any other step's answer passes as it came.
 * @param bundle - Dispatch bundle.
 * @param resp - Parsed answer.
 * @returns The answer the step's guards and extracts read, or a step failure.
 */
function openStepAnswer(bundle: IDispatchBundle, resp: JsonValue): Procedure<IOpenedAnswer> {
  const codec = bundle.fireScope.step.codec;
  if (codec === undefined) return succeed({ bundle, answer: resp });
  if (hasBankErrorCode(resp)) return bankErrorOf(bundle.fireScope.step);
  return modeOf(codec).open(bundle, codec, resp);
}

/**
 * Open a codec step's answer, then guard it against bank errors (N20): the
 * guard pointers read the opened view.
 * @param bundle - Dispatch bundle.
 * @param resp - Parsed answer.
 * @returns The answer the step's outcome and extracts read, or a step failure.
 */
function openGuardedAnswer(bundle: IDispatchBundle, resp: JsonValue): Procedure<IOpenedAnswer> {
  const opened = openStepAnswer(bundle, resp);
  if (!isOk(opened)) return opened;
  const guarded = guardBankError(bundle.fireScope.step, opened.value.answer);
  if (!isOk(guarded)) return guarded;
  return opened;
}

export { openGuardedAnswer, sealGuardedBody };
