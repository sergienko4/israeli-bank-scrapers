/**
 * Pipeline trace service — emits 7-stage phase transitions to stderr.
 * Infrastructure concern — lives in Core/, not Types/.
 */

/** Trace outcome after phase execution. */
type TraceStatus = string;

/**
 * Build phase trace tag.
 * @param index - 0-based phase index.
 * @param total - Total phase count.
 * @param name - Phase name.
 * @returns Formatted tag string.
 */
function buildPhaseTag(index: number, total: number, name: string): TraceStatus {
  return `[PIPELINE] [${String(index + 1)}/${String(total)}] ${name}`;
}

/**
 * Emit phase start trace to stderr.
 * @param tag - Phase tag from buildPhaseTag.
 * @returns The tag (pass-through for chaining).
 */
function traceStart(tag: TraceStatus): TraceStatus {
  process.stderr.write(`${tag} → START\n`);
  return tag;
}

/**
 * Emit phase result trace to stderr.
 * @param tag - Phase tag from buildPhaseTag.
 * @param isSuccess - Whether the phase succeeded.
 * @returns The tag (pass-through).
 */
function traceResult(tag: TraceStatus, isSuccess: boolean): TraceStatus {
  if (isSuccess) {
    process.stderr.write(`${tag} → OK\n`);
    return tag;
  }
  process.stderr.write(`${tag} → FAIL\n`);
  return tag;
}

export default buildPhaseTag;
export { buildPhaseTag, traceResult, traceStart };
