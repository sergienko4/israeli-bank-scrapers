/**
 * Body preparation + dispatch-bundle assembly — hydration, crypto
 * field, credential seal, AES body-pointer signing, form-body guard,
 * fire-args assembly, log-context.
 */

import { getDebug } from '../../../Logging/Debug.js';
import type { IFetchCallPolicy } from '../../../Types/Domain/FetchPolicy.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { isOk, succeed } from '../../../Types/Procedure.js';
import type { IBodyTemplate } from '../ConfigContracts/index.js';
import { hydrate } from '../Template/GenericBodyTemplate.js';
import type { ITemplateScope } from '../Template/RefResolver.js';
import buildOnSetCookie from './RunStep.cookies.js';
import { guardFormBody } from './RunStep.form.js';
import { attachHeaderCapture } from './RunStep.headerCarry.js';
import { buildStepHeaders } from './RunStep.headers.js';
import { applySeal } from './RunStep.seal.js';
import type {
  CarryMap,
  IAssembleFireArgs,
  IDispatchBundle,
  IFireArgs,
  IHeadersAndFireArgs,
  IPostPrepArgs,
  IPreparedBody,
  IRunStepArgs,
  IStepConfig,
  IStepLogContext,
  JsonValue,
  MutableHeaderMap,
  OnSetCookie,
  QueryRecord,
} from './RunStep.types.js';
import { applyCryptoField, attachBodySignature, primeStepCarry } from './RunStepBodySigning.js';

const LOG = getDebug(import.meta.url);

/**
 * Merge the new carry map on top of the previous scope's carry.
 * @param scope - Current scope.
 * @param addition - New carry fields from the step.
 * @returns Scope with merged carry (immutable).
 */
function mergeScopeCarry(scope: ITemplateScope, addition: CarryMap): ITemplateScope {
  const merged = { ...scope.carry, ...addition };
  return { ...scope, carry: merged };
}

/** Args bundle for `hydrateAndCrypto` — keeps signature single-line. */
interface IHydrateAndCryptoArgs {
  readonly args: IRunStepArgs;
  readonly primedScope: ITemplateScope;
  readonly template: IBodyTemplate;
}

/**
 * Hydrate the body template, then apply cryptoField and the credential
 * seal when configured.
 * @param input - Hydrate-and-crypto args bundle.
 * @returns Procedure with the pre-signature prepared body.
 */
function hydrateAndCrypto(input: IHydrateAndCryptoArgs): Procedure<IPreparedBody> {
  const { args, primedScope, template } = input;
  const bodyProc = hydrate(template.shape, primedScope);
  if (!isOk(bodyProc)) return bodyProc;
  const hydratedBody = bodyProc.value as Record<string, unknown>;
  const cryptoArgs = { step: args.step, scope: primedScope, body: hydratedBody };
  const afterCrypto = applyCryptoField(cryptoArgs);
  if (!isOk(afterCrypto)) return afterCrypto;
  return applySeal(args.step, afterCrypto.value);
}

/**
 * Attach the AES body-pointer signature when configured.
 * @param preBody - Pre-signature prepared body.
 * @param pathAndQuery - Canonical pathAndQuery for AES signing.
 * @returns Procedure with the signed body + scope.
 */
function attachBodySig(preBody: IPreparedBody, pathAndQuery: string): Procedure<IPreparedBody> {
  const sigArgs = { scope: preBody.scope, body: preBody.body, pathAndQuery };
  const signedProc = attachBodySignature(sigArgs);
  if (!isOk(signedProc)) return signedProc;
  return succeed({ body: signedProc.value, scope: preBody.scope });
}

/**
 * Resolve the step's body — hydrate template, prime carry, apply
 * cryptoField encryption, seal the credential field, attach the AES
 * body-pointer signature. A GET step sends no body, so only its carry is
 * primed.
 * @param args - Run-step args.
 * @param pathAndQuery - Canonical-string path+query.
 * @returns Procedure with the ready-to-send body + the post-prep scope.
 */
function prepareStepBody(args: IRunStepArgs, pathAndQuery: string): Procedure<IPreparedBody> {
  const primedScope = primeStepCarry(args.scope, args.step);
  const step = args.step;
  if (step.method === 'GET') return succeed({ body: {}, scope: primedScope });
  const preProc = hydrateAndCrypto({ args, primedScope, template: step.body });
  if (!isOk(preProc)) return preProc;
  const signed = attachBodySig(preProc.value, pathAndQuery);
  if (!isOk(signed)) return signed;
  return guardFormBody(step, signed.value);
}

/**
 * Merge the optional Set-Cookie sink into the fire bundle.
 * @param fireBase - Fire-call bundle without sink.
 * @param maybe - Result from buildOnSetCookie.
 * @returns Fire-call bundle with onSetCookie present only when truthy.
 */
function attachSink(fireBase: IFireArgs, maybe: OnSetCookie | false): IFireArgs {
  if (maybe === false) return fireBase;
  return { ...fireBase, onSetCookie: maybe };
}

/**
 * Every call-policy field a step can name, unset ones included.
 * @param step - Step config.
 * @returns The redirect policy, response kind, document marker, text cap and
 *   body encoding, each possibly undefined.
 */
function policyFieldsOf(step: IStepConfig): IFetchCallPolicy {
  const { redirect, documentMarker, maxTextChars } = step;
  const responseKind = step.response;
  return { redirect, responseKind, documentMarker, maxTextChars, bodyEncoding: step.encoding };
}

/**
 * The call policy a step names, when it names one.
 * @param step - Step config.
 * @returns `{ policy }` with only the policy fields the step names, or nothing.
 */
function callPolicyOf(step: IStepConfig): Pick<IFireArgs, 'policy'> {
  const fields = policyFieldsOf(step);
  const named = Object.entries(fields).filter(([, value]): boolean => value !== undefined);
  if (named.length === 0) return {};
  const policy = Object.fromEntries(named) as IFetchCallPolicy;
  return { policy };
}

/**
 * The fire args a step sends: body, query, headers and its call policy.
 * @param opts - Assemble args bundle.
 * @returns Fire-call args without hooks.
 */
function baseFire(opts: IAssembleFireArgs): IFireArgs {
  return {
    body: opts.preparedBody.body,
    query: opts.query,
    extraHeaders: opts.headers,
    ...callPolicyOf(opts.args.step),
  };
}

/**
 * Build the final IFireArgs bundle: the step's call policy, its optional
 * response-header capture and its optional cookie sink.
 * @param opts - Assemble args bundle.
 * @returns Fire-call args ready for fireStep.
 */
function assembleFire(opts: IAssembleFireArgs): IFireArgs {
  const fireBase = baseFire(opts);
  const captured = attachHeaderCapture(fireBase, opts.args.step);
  const onSetCookie = buildOnSetCookie(opts.args);
  return attachSink(captured, onSetCookie);
}

/**
 * Read top-level keys from a JsonValue, returning [] for non-objects.
 * @param value - Any JSON value.
 * @returns Top-level keys (empty for non-objects).
 */
function topLevelKeys(value: JsonValue): readonly string[] {
  if (typeof value !== 'object' || value === null) return [];
  if (Array.isArray(value)) return [];
  return Object.keys(value);
}

/**
 * Build the safe diagnostic context for per-step traces. PII-safe.
 * @param step - Step config.
 * @param bodyValue - Hydrated body (only top-level keys are read).
 * @returns Structured context fields ready to splat into log calls.
 */
function buildStepContext(step: IStepConfig, bodyValue: JsonValue): IStepLogContext {
  return {
    stepName: step.name,
    urlTag: step.urlTag,
    bodyKeys: topLevelKeys(bodyValue),
    extractKeys: Object.keys(step.extractsToCarry),
  };
}

/**
 * Construct the IFireArgs payload from the prepared body + headers.
 * @param opts - Post-prep args bundle.
 * @param headers - Resolved header map.
 * @returns Fire-call payload.
 */
function makeFireArgs(opts: IPostPrepArgs, headers: MutableHeaderMap): IFireArgs {
  return assembleFire({
    args: opts.args,
    preparedBody: opts.preparedBody,
    query: opts.query,
    headers,
  });
}

/**
 * Build headers + fire bundle for the post-prep dispatch stage.
 * @param args - Headers-and-fire args bundle.
 * @returns Procedure with the assembled dispatch bundle.
 */
function headersAndFire(args: IHeadersAndFireArgs): Procedure<IDispatchBundle> {
  const { opts, fireScope, baseCtx } = args;
  const bodyJson = JSON.stringify(opts.preparedBody.body);
  const headerInput = { bodyJson, pathAndQuery: opts.pathAndQuery };
  const headersProc = buildStepHeaders(fireScope, headerInput);
  if (!isOk(headersProc)) return headersProc;
  const fireArgs = makeFireArgs(opts, headersProc.value);
  return succeed({ fireArgs, fireScope, baseCtx, preparedScope: opts.preparedBody.scope });
}

/**
 * Assemble fireScope + baseCtx and delegate to {@link headersAndFire}.
 * @param opts - Post-prep args bundle.
 * @returns Procedure with the dispatch bundle.
 */
function finalizeDispatch(opts: IPostPrepArgs): Procedure<IDispatchBundle> {
  const fireScope = { ...opts.args, scope: opts.preparedBody.scope };
  const baseCtx = buildStepContext(opts.args.step, opts.preparedBody.body as JsonValue);
  LOG.debug({ ...baseCtx, message: '[runStep] START' });
  return headersAndFire({ opts, fireScope, baseCtx });
}

/** Args bundle for `buildDispatchBundle` — keeps the signature single-line. */
interface IBuildDispatchArgs {
  readonly args: IRunStepArgs;
  readonly pathAndQuery: string;
  readonly query: QueryRecord;
}

/**
 * Hydrate the request body and build the dispatch bundle.
 * @param input - Build-dispatch args bundle.
 * @returns Procedure with the dispatch bundle, or fail.
 */
function buildDispatchBundle(input: IBuildDispatchArgs): Procedure<IDispatchBundle> {
  const { args, pathAndQuery, query } = input;
  const prepProc = prepareStepBody(args, pathAndQuery);
  if (!isOk(prepProc)) return prepProc;
  const queryMut = { ...query };
  const opts: IPostPrepArgs = { args, preparedBody: prepProc.value, pathAndQuery, query: queryMut };
  return finalizeDispatch(opts);
}

export default buildDispatchBundle;

export { buildDispatchBundle, mergeScopeCarry };
export type { IBuildDispatchArgs };
