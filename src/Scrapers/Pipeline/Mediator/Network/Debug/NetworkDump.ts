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
import { redactJsonBody, redactUrl, redactUrlFull } from '../../../Types/PiiRedactor.js';
import { getSubStepNetworkDumpDir } from '../../../Types/TraceConfig.js';

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
function dumpResponseBody(args: IDumpArgs): number {
  const phase = getActivePhase();
  const stage = getActiveStage();
  const dir = getSubStepNetworkDumpDir(phase, stage);
  // Always increment so `captureIndex` stays a stable per-process
  // counter even when trace artefacts aren't being written to disk —
  // the index is also the log-side correlation key.
  dumpCounter += 1;
  if (!dir) return dumpCounter;
  try {
    // Redact account / card IDs in path segments BEFORE the regex
    // safe-encoding pass so identifiers never reach the on-disk
    // filename. `redactUrl` (query) + `redactAccount` (per-segment)
    // is composed inside `redactUrlFull` — same masking we use in
    // structured discovery logs, single source of truth.
    const safeStub = redactUrlFull(args.url)
      .replaceAll(/[^\w.-]/g, '_')
      .slice(-80);
    const name = `${String(dumpCounter).padStart(4, '0')}-${args.method}-${safeStub}.json`;
    const filePath = path.join(dir, name);
    const safeUrl = redactUrl(args.url);
    const safePostData = redactJsonBody(args.postData);
    const safeText = redactJsonBody(args.text);
    const postSuffix = { true: '', false: `\n// POST_BODY: ${safePostData}` };
    const postLine = postSuffix[String(args.postData.length === 0) as 'true' | 'false'];
    fs.writeFileSync(filePath, `// ${args.method} ${safeUrl}${postLine}\n${safeText}`);
    return dumpCounter;
  } catch {
    return dumpCounter;
  }
}

export type { IDumpArgs };
export { dumpResponseBody };
