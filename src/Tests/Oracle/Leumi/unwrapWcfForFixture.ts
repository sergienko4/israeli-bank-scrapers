import ScraperError from '../../../Scrapers/Base/ScraperError.js';
import type { JsonValue } from '../../../Scrapers/Pipeline/Types/JsonValue.js';

type JsonObject = Record<string, JsonValue>;

/** Message used when a representative SOAP/WCF fixture is malformed. */
const INVALID_WCF_FIXTURE = 'invalid SOAP/WCF oracle fixture';

/**
 * Checks whether a JSON value is an object record.
 * @param value - Candidate JSON value.
 * @returns True when the value is a non-array object.
 */
function isRecord(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parses a JSON string payload carried inside a SOAP/WCF result field.
 * @param payload - Result payload from the fixture envelope.
 * @returns Parsed JSON or false when the payload is invalid.
 */
function parsePayload(payload: JsonValue): JsonValue | false {
  if (typeof payload !== 'string') return false;
  try {
    return JSON.parse(payload) as JsonValue;
  } catch {
    return false;
  }
}

/**
 * Reads the synthetic Broker-style result slot from the fixture envelope.
 * @param envelope - Fixture-level SOAP/WCF wrapper.
 * @returns String payload when present, otherwise false.
 */
function readResultSlot(envelope: JsonValue): JsonValue | false {
  if (!isRecord(envelope) || !isRecord(envelope.Envelope)) return false;
  const body = envelope.Envelope.Body;
  if (!isRecord(body) || !isRecord(body.GetAccountDataResponse)) return false;
  return body.GetAccountDataResponse.GetAccountDataResult ?? false;
}

/**
 * Unwraps a representative SOAP/WCF fixture before generic parsing.
 *
 * This mirrors the documented future-adapter boundary: envelope unwrap
 * belongs outside the shared response path, and tests hand plain JSON to
 * the generic parser/extractor seam.
 *
 * @param envelope - Synthetic SOAP/WCF fixture payload.
 * @returns Plain JSON body for generic pipeline seams.
 * @throws Error when the fixture does not match the representative shape.
 */
export default function unwrapWcfForFixture(envelope: JsonValue): JsonValue {
  const resultSlot = readResultSlot(envelope);
  const parsed = parsePayload(resultSlot);
  if (parsed === false) throw new ScraperError(INVALID_WCF_FIXTURE);
  return parsed;
}
