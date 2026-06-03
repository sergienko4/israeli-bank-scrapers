/**
 * Outbound header assembly — static + signer + optional cookies.
 * Tight branching: one validation gate in `attachSignerHeader`, the
 * non-AES signer narrowed and threaded explicitly into the canonical
 * builder so no defensive re-checks duplicate branches downstream.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { IGenericKeypair } from '../Crypto/CryptoKeyFactory.js';
import { buildCanonical } from '../Crypto/GenericCanonicalStringBuilder.js';
import { signCanonical } from '../Crypto/GenericCryptoSigner.js';
import type {
  HeaderMap,
  IAttachSignerArgs,
  IHeaderAssembly,
  IRunStepArgs,
  ISignerInput,
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
 * Append the Cookie header to `out` when the jar has any entries.
 * @param out - Mutable outbound header map.
 * @param args - Run-step args.
 * @returns Header map (returned for fluent chaining).
 */
function applyCookieHeader(out: MutableHeaderMap, args: IRunStepArgs): MutableHeaderMap {
  if (!args.step.cookieJar) return out;
  if (args.cookieJar === undefined) return out;
  const h = args.cookieJar.header();
  if (h.length === 0) return out;
  out.Cookie = h;
  return out;
}

/** Bundle for `attachWithKeypair` — keeps the signature single-line. */
interface IAttachWithKeypairArgs {
  readonly args: IAttachSignerArgs;
  readonly signer: NonAesSignerConfig;
  readonly keypair: IGenericKeypair;
}

/**
 * Run computeSignerHeader and attach the result under signer.headerName.
 * @param opts - Validated-signer attach bundle.
 * @returns Procedure with the merged header map.
 */
function attachWithKeypair(opts: IAttachWithKeypairArgs): Procedure<HeaderMap> {
  const { args, signer, keypair } = opts;
  const { pathAndQuery, bodyJson } = args.assembly;
  const input: ISignerInput = { pathAndQuery, bodyJson, keypair };
  const sigProc = computeSignerHeader({ signer, input });
  if (!isOk(sigProc)) return sigProc;
  args.out[signer.headerName] = sigProc.value;
  return succeed(args.out);
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

/**
 * Build the outbound header map — static + signer + optional cookies.
 * @param args - Run-step args.
 * @param assembly - Body JSON + computed pathAndQuery.
 * @returns Procedure with the header map, or signer-failure.
 */
function buildStepHeaders(args: IRunStepArgs, assembly: IHeaderAssembly): Procedure<HeaderMap> {
  const staticHeaders = args.scope.config.staticHeaders ?? {};
  const seeded: MutableHeaderMap = { ...staticHeaders };
  const out = applyCookieHeader(seeded, args);
  return attachSignerHeader({ args, assembly, out });
}

export default buildStepHeaders;

export { buildStepHeaders };
