/**
 * Network Indexing / ResponseEnvelope — structural WCF `Broker.svc`
 * envelope unwrap.
 *
 * <p>Some bank backends wrap the real JSON payload in a
 * `{ ProcessRequestResult: <number>, jsonResp: "<stringified JSON>" }`
 * envelope (the Microsoft WCF `Broker.svc/ProcessRequest` convention).
 * The payload the rest of the pipeline cares about (account / balance /
 * transaction containers) lives INSIDE the `jsonResp` string and must
 * be JSON-parsed a SECOND time before any downstream picker or
 * auto-mapper can see it.
 *
 * <p>This is a SHAPE rule, not a bank identity: any capture matching
 * the exact envelope shape is unwrapped, so the downstream picker sees
 * the real container without a single bank-specific branch. Bodies that
 * do not match the precise shape pass through untouched (default-deny —
 * only the exact envelope is transformed), and malformed inner JSON
 * falls back to the original body (fail-safe).
 */

/** Envelope key carrying the numeric WCF result/status code. */
const ENVELOPE_RESULT_KEY = 'ProcessRequestResult';
/** Envelope key carrying the stringified inner JSON payload. */
const ENVELOPE_PAYLOAD_KEY = 'jsonResp';
/** Exact own-key count of the envelope — extra keys break the match. */
const ENVELOPE_KEY_COUNT = 2;

/**
 * True iff `body` is exactly the WCF
 * `{ ProcessRequestResult: number, jsonResp: string }` envelope. Extra
 * keys disqualify it so a non-envelope payload that merely carries both
 * fields is never unwrapped (default-deny).
 * @param body - Parsed response body.
 * @returns True iff the strict envelope shape matches.
 */
function isWcfEnvelope(body: unknown): body is Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return false;
  const rec = body as Record<string, unknown>;
  if (Object.keys(rec).length !== ENVELOPE_KEY_COUNT) return false;
  return (
    typeof rec[ENVELOPE_RESULT_KEY] === 'number' && typeof rec[ENVELOPE_PAYLOAD_KEY] === 'string'
  );
}

/**
 * Unwrap the WCF `Broker.svc` envelope when present — returns the
 * parsed inner `jsonResp` payload. Non-envelope bodies and malformed
 * inner JSON fall through to the original body (fail-safe).
 * @param body - Parsed response body.
 * @returns Inner payload when the envelope matches, else the input body.
 */
function unwrapWcfEnvelope(body: unknown): unknown {
  if (!isWcfEnvelope(body)) return body;
  const inner = body[ENVELOPE_PAYLOAD_KEY] as string;
  try {
    return JSON.parse(inner) as unknown;
  } catch {
    return body;
  }
}

export { isWcfEnvelope, unwrapWcfEnvelope };
