/**
 * Bootstrap helpers: random-hex-16, sha256-prefix-16, and JWT-claim
 * extraction — each surfacing a string Procedure for the dispatcher.
 */

import { createHash, randomBytes } from 'node:crypto';

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import { toErrorMessage } from '../../../Types/ErrorUtils.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type {
  Creds,
  IJwtClaimArgs,
  IMakeJwtClaimArgs,
  IStepJsonPathArgs,
  IWalkJsonCtx,
  SeedCarryBootstrapKind,
} from './FlowInitCarry.types.js';

/** Random-hex generator size used by the `'random-hex-16'` bootstrap. */
const RANDOM_HEX_16_BYTES = 16;

/** Hex prefix length produced by the `'sha256-prefix-16'` bootstrap. */
const SHA256_PREFIX_LENGTH = 16;

/** Index of the JWT payload segment (between header and signature). */
const JWT_PAYLOAD_SEGMENT_INDEX = 1;

/** Number of dot-separated segments in a compact JWT (header.payload.signature). */
const JWT_SEGMENT_COUNT = 3;

/**
 * Generate a fresh random-hex string of the configured byte length.
 * @returns Procedure with the generated value.
 */
function bootstrapRandomHex16(): Procedure<string> {
  const hex = randomBytes(RANDOM_HEX_16_BYTES).toString('hex');
  return succeed(hex);
}

/**
 * Standard failure for missing/empty source on sha256-prefix-16.
 * @param from - Creds field name.
 * @returns Procedure failure.
 */
function sha256MissingFail(from: string): Procedure<string> {
  return fail(
    ScraperErrorTypes.Generic,
    `sha256-prefix-16 bootstrap: creds.${from} missing or empty`,
  );
}

/**
 * Deterministically derive a 16-character hex prefix from another creds field.
 * @param from - Creds field name whose UTF-8 bytes are hashed.
 * @param creds - Caller credentials.
 * @returns Procedure with the 16-hex prefix (lowercase).
 */
function bootstrapSha256Prefix16(from: string, creds: Creds): Procedure<string> {
  const raw = creds[from];
  if (typeof raw !== 'string' || raw.length === 0) return sha256MissingFail(from);
  const digest = createHash('sha256').update(raw, 'utf8').digest('hex');
  const prefix = digest.slice(0, SHA256_PREFIX_LENGTH);
  return succeed(prefix);
}

/**
 * Step the json-path walker one segment forward.
 * @param args - Cursor + segment + walk context bundle.
 * @returns Updated cursor procedure.
 */
function stepJsonPath(args: IStepJsonPathArgs): Procedure<unknown> {
  const { acc, segment, ctx } = args;
  if (!isOk(acc)) return acc;
  const cursor = acc.value;
  if (cursor === null || typeof cursor !== 'object') {
    return fail(ScraperErrorTypes.Generic, `jwt-claim: path '${ctx.path}' miss at '${segment}'`);
  }
  return succeed((cursor as Record<string, unknown>)[segment]);
}

/**
 * Coerce the final walker cursor to a string Procedure.
 * @param walked - Walker outcome.
 * @param path - Dotted path (for diagnostics).
 * @returns Procedure with the string value.
 */
function coerceWalkedString(walked: Procedure<unknown>, path: string): Procedure<string> {
  if (!isOk(walked)) return walked;
  if (typeof walked.value !== 'string') {
    return fail(ScraperErrorTypes.Generic, `jwt-claim: path '${path}' non-string`);
  }
  return succeed(walked.value);
}

/**
 * Walk a dotted path through a record-of-records, returning the leaf string.
 * @param root - Decoded JWT payload (untyped JSON).
 * @param path - Dotted path (e.g. `pl.uId`).
 * @returns Procedure with the leaf string.
 */
function walkJsonPath(root: unknown, path: string): Procedure<string> {
  const segments = path.split('.');
  const seed: Procedure<unknown> = succeed(root);
  const ctx: IWalkJsonCtx = { path };
  const walked = segments.reduce<Procedure<unknown>>(
    (acc, segment) => stepJsonPath({ acc, segment, ctx }),
    seed,
  );
  return coerceWalkedString(walked, path);
}

/**
 * Decode + parse one base64url JWT segment.
 * @param payloadB64 - Raw base64url-encoded JWT payload segment.
 * @returns Procedure with the parsed value or fail.
 */
function tryParseJwtSegment(payloadB64: string): Procedure<unknown> {
  try {
    const decoded = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded) as unknown;
    return succeed(parsed);
  } catch (error) {
    const reason = toErrorMessage(error);
    return fail(ScraperErrorTypes.Generic, `jwt-claim: payload decode failed: ${reason}`);
  }
}

/**
 * Decode a JWT payload from base64url and parse it as JSON.
 * @param jwt - JWT string (three base64url-encoded segments).
 * @returns Procedure with the parsed payload.
 */
function decodeJwtPayload(jwt: string): Procedure<unknown> {
  const segments = jwt.split('.');
  if (segments.length !== JWT_SEGMENT_COUNT) {
    return fail(ScraperErrorTypes.Generic, 'jwt-claim: JWT must have 3 segments');
  }
  const payloadB64 = segments[JWT_PAYLOAD_SEGMENT_INDEX];
  return tryParseJwtSegment(payloadB64);
}

/**
 * Surface a missing/empty source — strict fails fast, optional yields ''.
 * @param args - Args bundle.
 * @returns Procedure with empty string (optional) or fail (strict).
 */
function emptySourceOutcome(args: IJwtClaimArgs): Procedure<string> {
  if (args.optional) return succeed('');
  const reason = `jwt-claim bootstrap: creds.${args.from} missing or empty`;
  return fail(ScraperErrorTypes.Generic, reason);
}

/**
 * Decode the JWT in `creds[args.from]` and walk to `args.claim`.
 * @param args - Bootstrap args bundle.
 * @returns Procedure with the leaf string.
 */
function bootstrapJwtClaim(args: IJwtClaimArgs): Procedure<string> {
  const raw = args.creds[args.from];
  if (typeof raw !== 'string' || raw.length === 0) return emptySourceOutcome(args);
  const decoded = decodeJwtPayload(raw);
  if (!isOk(decoded)) return decoded;
  return walkJsonPath(decoded.value, args.claim);
}

/**
 * Build the bootstrapJwtClaim args bundle from a discriminated descriptor.
 * @param args - Bootstrap descriptor + creds bundle.
 * @returns IJwtClaimArgs bundle.
 */
function makeJwtClaimArgs(args: IMakeJwtClaimArgs): IJwtClaimArgs {
  const { bootstrap, creds } = args;
  return {
    from: bootstrap.from,
    claim: bootstrap.claim,
    optional: bootstrap.optional === true,
    creds,
  };
}

/**
 * Dispatch parameterised bootstrap kinds (everything except random-hex-16).
 * @param bootstrap - Discriminated bootstrap descriptor (non-random kind).
 * @param creds - Caller credentials.
 * @returns Procedure with the bootstrap-produced value.
 */
function evalParameterisedBootstrap(
  bootstrap: Exclude<SeedCarryBootstrapKind, { kind: 'random-hex-16' }>,
  creds: Creds,
): Procedure<string> {
  if (bootstrap.kind === 'sha256-prefix-16') return bootstrapSha256Prefix16(bootstrap.from, creds);
  const args = makeJwtClaimArgs({ bootstrap, creds });
  return bootstrapJwtClaim(args);
}

/**
 * Dispatch a bootstrap kind to its generator.
 * @param bootstrap - Discriminated bootstrap descriptor.
 * @param creds - Caller credentials (consulted by parameterised kinds).
 * @returns Procedure with the bootstrap-produced value.
 */
function evalBootstrap(bootstrap: SeedCarryBootstrapKind, creds: Creds): Procedure<string> {
  if (bootstrap.kind === 'random-hex-16') return bootstrapRandomHex16();
  return evalParameterisedBootstrap(bootstrap, creds);
}

export default evalBootstrap;

export { evalBootstrap };
