/**
 * Outbound header assembly — static + step headers + optional cookies +
 * signer. The jar cookie and the signature are set last and replace a static
 * or step header of the same name whatever its case. Tight branching: one
 * validation gate in `attachSignerHeader`, the non-AES signer narrowed and
 * threaded explicitly into the canonical builder so no defensive re-checks
 * duplicate branches downstream.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { JsonValueTemplate } from '../ConfigContracts/index.js';
import type { IGenericKeypair } from '../Crypto/CryptoKeyFactory.js';
import { buildCanonical } from '../Crypto/GenericCanonicalStringBuilder.js';
import { signCanonical } from '../Crypto/GenericCryptoSigner.js';
import { hydrate } from '../Template/GenericBodyTemplate.js';
import type { ITemplateScope } from '../Template/RefResolver.js';
import type {
  HeaderMap,
  IAttachSignerArgs,
  IHeaderAssembly,
  IRunStepArgs,
  ISignerInput,
  JsonValue,
  MutableHeaderMap,
  NonAesSignerConfig,
} from './RunStep.types.js';

/** Args bundle for `computeSignerHeader` — single-line signature friendly. */
interface IComputeSignerArgs {
  readonly signer: NonAesSignerConfig;
  readonly input: ISignerInput;
}

/**
 * Compute the Content-Signature-style header value per the validated signer.
 * @param args - Pre-validated signer + canonical-string inputs.
 * @returns Procedure with the header value.
 */
function computeSignerHeader(args: IComputeSignerArgs): Procedure<string> {
  const canonicalProc = buildCanonical({
    canonical: args.signer.canonical,
    pathAndQuery: args.input.pathAndQuery,
    bodyJson: args.input.bodyJson,
  });
  if (!isOk(canonicalProc)) return canonicalProc;
  const bytes = Buffer.from(canonicalProc.value, 'utf8');
  return signCanonical(bytes, args.input.keypair, args.signer);
}

/**
 * Drop every header whose name matches `name` ignoring case.
 * @param headers - Header map.
 * @param name - Header name to drop.
 * @returns A copy without that name.
 */
function withoutHeader(headers: HeaderMap, name: string): MutableHeaderMap {
  const lower = name.toLowerCase();
  const kept = Object.entries(headers).filter(([key]): boolean => key.toLowerCase() !== lower);
  return Object.fromEntries(kept);
}

/**
 * Set the jar's Cookie header over any same-name header, whatever its case,
 * when the jar has any entries.
 * @param out - Outbound header map.
 * @param args - Run-step args.
 * @returns Header map carrying the jar cookie.
 */
function applyCookieHeader(out: MutableHeaderMap, args: IRunStepArgs): MutableHeaderMap {
  if (!args.step.cookieJar) return out;
  if (args.cookieJar === undefined) return out;
  const h = args.cookieJar.header();
  if (h.length === 0) return out;
  const kept = withoutHeader(out, 'Cookie');
  return { ...kept, Cookie: h };
}

/** Bundle for `attachWithKeypair` — keeps the signature single-line. */
interface IAttachWithKeypairArgs {
  readonly args: IAttachSignerArgs;
  readonly signer: NonAesSignerConfig;
  readonly keypair: IGenericKeypair;
}

/**
 * Run computeSignerHeader and set the result under signer.headerName, over
 * any same-name header whatever its case.
 * @param opts - Validated-signer attach bundle.
 * @returns Procedure with the merged header map.
 */
function attachWithKeypair(opts: IAttachWithKeypairArgs): Procedure<HeaderMap> {
  const { args, signer, keypair } = opts;
  const { pathAndQuery, bodyJson } = args.assembly;
  const input: ISignerInput = { pathAndQuery, bodyJson, keypair };
  const sigProc = computeSignerHeader({ signer, input });
  if (!isOk(sigProc)) return sigProc;
  const kept = withoutHeader(args.out, signer.headerName);
  return succeed({ ...kept, [signer.headerName]: sigProc.value });
}

/**
 * Attach the signer header to `out` when a non-AES signer is configured.
 * Single validation gate — narrows the signer and rejects the AES variant
 * (handled via a separate body-pointer hook before firePost).
 * @param args - Attach-signer args bundle.
 * @returns Procedure with the final header map.
 */
function attachSignerHeader(args: IAttachSignerArgs): Procedure<HeaderMap> {
  const signer = args.args.scope.config.signer;
  if (signer === undefined || signer.algorithm === 'AES-CBC-PKCS7') return succeed(args.out);
  const keypair = args.args.signingKeypair;
  if (keypair === undefined) {
    return fail(ScraperErrorTypes.Generic, 'signer configured but no signing keypair in scope');
  }
  return attachWithKeypair({ args, signer, keypair });
}

/** Headers built so far, or the first failure. */
type HeadersProc = Procedure<MutableHeaderMap>;

/** One step header: its name and value template. */
type HeaderEntry = readonly [string, JsonValueTemplate];

/**
 * A hydrated header value as text: a string as it is, anything else as JSON.
 * @param value - Hydrated header value.
 * @returns Header text.
 */
function headerText(value: JsonValue): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/**
 * Hydrate one step header and set it over any same-name header.
 * @param acc - Headers so far, or the first failure.
 * @param entry - Header name and value template.
 * @param scope - Step template scope.
 * @returns Headers with this one set, or the hydration failure.
 */
function setStepHeader(acc: HeadersProc, entry: HeaderEntry, scope: ITemplateScope): HeadersProc {
  if (!isOk(acc)) return acc;
  const [name, template] = entry;
  const valueProc = hydrate(template, scope);
  if (!isOk(valueProc)) return valueProc;
  const kept = withoutHeader(acc.value, name);
  const text = headerText(valueProc.value);
  return succeed({ ...kept, [name]: text });
}

/**
 * Hydrate the step's own headers over the static ones.
 * @param seeded - Static headers.
 * @param args - Run-step args (scope already primed for this step).
 * @returns Merged headers, or the first hydration failure.
 */
function applyStepHeaders(seeded: HeaderMap, args: IRunStepArgs): HeadersProc {
  const entries = Object.entries(args.step.headers ?? {});
  const start: HeadersProc = succeed({ ...seeded });
  return entries.reduce((acc, entry): HeadersProc => setStepHeader(acc, entry, args.scope), start);
}

/**
 * Build the outbound header map — static, then step headers, cookies, signer.
 * @param args - Run-step args.
 * @param assembly - Body JSON + computed pathAndQuery.
 * @returns Procedure with the header map, or a hydration / signer failure.
 */
function buildStepHeaders(args: IRunStepArgs, assembly: IHeaderAssembly): Procedure<HeaderMap> {
  const staticHeaders = args.scope.config.staticHeaders ?? {};
  const seeded = applyStepHeaders(staticHeaders, args);
  if (!isOk(seeded)) return seeded;
  const out = applyCookieHeader(seeded.value, args);
  return attachSignerHeader({ args, assembly, out });
}

export default buildStepHeaders;

export { buildStepHeaders };
