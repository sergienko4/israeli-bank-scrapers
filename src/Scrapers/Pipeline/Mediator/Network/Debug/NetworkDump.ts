/**
 * Network Dump — trace-mode helper that persists each captured response
 * (URL, method, POST body, parsed text) to disk under the run's
 * `network/` folder. Always increments a process-local counter so the
 * `captureIndex` field on every discovered endpoint stays a stable
 * correlation key joining a structured log line to its on-disk file.
 *
 * Extracted from NetworkDiscovery.ts (Phase 4 commit 1/9) — pure debug
 * surface, isolated from filter/parse/score logic.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { getActivePhase, getActiveStage } from '../../../Types/ActiveState.js';
import { getDebug } from '../../../Types/Debug.js';
import { toErrorMessage } from '../../../Types/ErrorUtils.js';
import { redactJsonBody, redactUrl, redactUrlFull } from '../../../Types/PiiRedactor.js';
import { getSubStepNetworkDumpDir } from '../../../Types/TraceConfig.js';

const LOG = getDebug(import.meta.url);

/**
 * Per-run dump counter — each response body that gets dumped is numbered so
 * the on-disk order matches the order they fired during the run. The dump
 * folder itself is owned by TraceConfig (single per-process root for logs,
 * network, and screenshots — gated by `LOG_LEVEL=trace`).
 */
let dumpCounter = 0;

/** Bundled args for `dumpResponseBody` — keeps the helper inside the
 *  3-param ceiling while exposing both the request body (POST payload)
 *  and the response body to the trace-mode dump file. */
interface IDumpArgs {
  readonly url: string;
  readonly method: string;
  readonly postData: string;
  readonly text: string;
}

/**
 * Debug hook: write each parsed response body to the trace-mode network
 * dump folder, alongside the captured POST request body so future audits
 * can replay the exact request shape (needed for `.ashx`-removal work
 * where we replace legacy reqName=… GETs with modern POST endpoints).
 * Returns immediately when not in trace mode (TraceConfig's
 * `getNetworkDumpDir` returns empty string off-trace). Silent failures
 * to avoid impacting the pipeline when the debug target is bad.
 * @param args - Bundled url/method/postData/responseText.
 * @returns Count of dumps so far.
 */
/** Bundled args for the actual disk write — keeps `tryWriteDump` under
 *  the per-function cap and the helper inside the 3-param ceiling. */
interface IWriteArgs {
  readonly args: IDumpArgs;
  readonly dir: string;
  readonly sequence: number;
}

/**
 * Build the redacted file path for one dump entry.
 * @param dir - Trace-mode network dump folder.
 * @param sequence - Per-process counter value.
 * @param args - Dump arguments (url + method only used here).
 * @returns Absolute path to the new dump file.
 */
function buildDumpPath(dir: string, sequence: number, args: IDumpArgs): string {
  const redacted = redactUrlFull(args.url);
  const sanitised = redacted.replaceAll(/[^\w.-]/g, '_');
  const safeStub = sanitised.slice(-80);
  const prefix = String(sequence).padStart(4, '0');
  const name = `${prefix}-${args.method}-${safeStub}.json`;
  return path.join(dir, name);
}

/**
 * Format the dump-file contents from the captured request + response.
 * @param args - Dump arguments.
 * @returns Newline-joined string ready to write to disk.
 */
function formatDumpBody(args: IDumpArgs): string {
  const safeUrl = redactUrl(args.url);
  const safePostData = redactJsonBody(args.postData);
  const safeText = redactJsonBody(args.text);
  const postSuffix = { true: '', false: `\n// POST_BODY: ${safePostData}` };
  const postLine = postSuffix[String(args.postData.length === 0) as 'true' | 'false'];
  return `// ${args.method} ${safeUrl}${postLine}\n${safeText}`;
}

/**
 * Log the error path of {@link tryWriteDump} as a structured trace.
 * @param payload - Bundled write args.
 * @param error - Caught I/O error.
 * @returns Sequence number (unchanged from input).
 */
function logDumpWriteError(payload: IWriteArgs, error: Error): number {
  LOG.trace({
    event: 'NetworkDump.write.error',
    dumpCounter: payload.sequence,
    url: redactUrl(payload.args.url),
    error: toErrorMessage(error),
  });
  return payload.sequence;
}

/**
 * Write the dump file to disk, swallowing errors after a trace log.
 * Keeps `dumpResponseBody` thin so the per-function 20-LoC cap holds.
 * @param payload - Bundled write args (args + dir + sequence).
 * @returns Sequence number (unchanged from input).
 */
function tryWriteDump(payload: IWriteArgs): number {
  try {
    const filePath = buildDumpPath(payload.dir, payload.sequence, payload.args);
    const body = formatDumpBody(payload.args);
    fs.writeFileSync(filePath, body);
    return payload.sequence;
  } catch (error) {
    return logDumpWriteError(payload, error as Error);
  }
}

/**
 * Debug hook: write each parsed response body to the trace-mode network
 * dump folder, alongside the captured POST request body so future audits
 * can replay the exact request shape. Always increments the counter so
 * `captureIndex` stays a stable correlation key even off-trace.
 * @param args - Bundled url/method/postData/responseText.
 * @returns Count of dumps so far.
 */
function dumpResponseBody(args: IDumpArgs): number {
  const phase = getActivePhase();
  const stage = getActiveStage();
  const dir = getSubStepNetworkDumpDir(phase, stage);
  dumpCounter += 1;
  if (!dir) return dumpCounter;
  return tryWriteDump({ args, dir, sequence: dumpCounter });
}

export type { IDumpArgs };
export { dumpResponseBody };
