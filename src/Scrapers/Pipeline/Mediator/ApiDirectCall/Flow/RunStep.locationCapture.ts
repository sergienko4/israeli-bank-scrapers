/**
 * Handoff script capture. A `text` step's `locationCapture` reads every
 * `<script>` body on its answer (a `src` script's is empty) and walks it on
 * the path `userAgent` selects. A script outside the grammar fails `<step>
 * handoff script unsupported`; no assignment over all scripts `<step> handoff
 * missing`, two or more `<step> handoff ambiguous`. The one URL is resolved
 * against the URL that answered and must pass `url`, else `<step> handoff
 * refused`; it goes to carry `into`. No failure names the URL, and it is
 * never logged.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import { matchesAnyUrlRule } from '../../../Strategy/Fetch/UrlRule.js';
import type { IProcedureFailure, Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';
import type { ILocationCapture, IStepConfig } from '../ConfigContracts/index.js';
import { tokenizeScript } from './RunStep.locationScriptLexer.js';
import { selectedTargets } from './RunStep.locationScriptWalk.js';
import { answerText } from './RunStep.textCapture.js';
import type { CarryMap, IRunStepArgs, JsonValue } from './RunStep.types.js';

const OPEN_HEAD = /<script\b/gi;
const CLOSE_TAG = /<\/script>/gi;

/** One script's body and where its end tag ends. */
interface IScriptSpan {
  readonly body: string;
  readonly end: number;
}

/** The step, its capture and its URL. */
interface IHandoffPick {
  readonly step: IStepConfig;
  readonly capture: ILocationCapture;
  readonly stepUrl: string;
}

/**
 * Fail the capture, naming the step only.
 * @param step - Step config.
 * @param reason - Why it failed.
 * @returns Generic failure.
 */
function refuse(step: IStepConfig, reason: string): IProcedureFailure {
  return fail(ScraperErrorTypes.Generic, `${step.name} handoff ${reason}`);
}

/**
 * The script whose body starts at `bodyAt`, up to its end tag.
 * @param html - Page text.
 * @param bodyAt - Where the body starts.
 * @returns The script, or false when it is never closed.
 */
function closedScript(html: string, bodyAt: number): IScriptSpan | false {
  CLOSE_TAG.lastIndex = bodyAt;
  const close = CLOSE_TAG.exec(html);
  if (close === null) return false;
  return { body: html.slice(bodyAt, close.index), end: close.index + close[0].length };
}

/**
 * The first script from `from`.
 * @param html - Page text.
 * @param from - Where to look from.
 * @returns The script, or false when none starts and closes there.
 */
function scriptFrom(html: string, from: number): IScriptSpan | false {
  OPEN_HEAD.lastIndex = from;
  const head = OPEN_HEAD.exec(html);
  if (head === null) return false;
  const bodyAt = html.indexOf('>', head.index) + 1;
  if (bodyAt === 0) return false;
  return closedScript(html, bodyAt);
}

/**
 * Every script body on a page, in page order, up to an unclosed one.
 * @param html - Page text.
 * @returns The bodies.
 */
function scriptBodies(html: string): readonly string[] {
  const bodies: string[] = [];
  for (let span = scriptFrom(html, 0); span !== false; span = scriptFrom(html, span.end)) {
    bodies.push(span.body);
  }
  return bodies;
}

/**
 * Add the URLs one script assigns on the selected path.
 * @param body - Script body.
 * @param userAgent - The User-Agent its tests read.
 * @param picked - URLs found so far.
 * @returns False when the script is refused.
 */
function pickFrom(body: string, userAgent: string, picked: string[]): boolean {
  const tokens = tokenizeScript(body);
  if (tokens === false) return false;
  const targets = selectedTargets(tokens, userAgent);
  if (targets === false) return false;
  picked.push(...targets);
  return true;
}

/**
 * Resolve the one selected URL and carry it once it passes the rules.
 * @param pick - The step, its capture and its URL.
 * @param target - The assigned URL, as written.
 * @returns The `into` slot, or `<step> handoff refused`.
 */
function carryTarget(pick: IHandoffPick, target: string): Procedure<CarryMap> {
  if (!URL.canParse(target, pick.stepUrl)) return refuse(pick.step, 'refused');
  const url = new URL(target, pick.stepUrl);
  if (!matchesAnyUrlRule(url, pick.capture.url)) return refuse(pick.step, 'refused');
  return succeed({ [pick.capture.into]: url.href });
}

/**
 * Capture the handoff URL off a page.
 * @param pick - The step, its capture and its URL.
 * @param html - Page text.
 * @returns The `into` slot, or the refusal.
 */
function captureFrom(pick: IHandoffPick, html: string): Procedure<CarryMap> {
  const picked: string[] = [];
  const bodies = scriptBodies(html);
  const isRead = bodies.every((body): boolean => pickFrom(body, pick.capture.userAgent, picked));
  if (!isRead) return refuse(pick.step, 'script unsupported');
  if (picked.length === 0) return refuse(pick.step, 'missing');
  if (picked.length > 1) return refuse(pick.step, 'ambiguous');
  return carryTarget(pick, picked[0]);
}

/**
 * Capture a step's handoff URL from its `{ text }` answer.
 * @param args - The step and its company.
 * @param resp - The step's answer.
 * @param url - Validated URL that answered the step.
 * @returns The `into` slot, {} without a capture, or the refusal.
 */
function captureLocation(args: IRunStepArgs, resp: JsonValue, url: string): Procedure<CarryMap> {
  const { step } = args;
  if (step.locationCapture === undefined) return succeed({});
  const pick: IHandoffPick = { step, capture: step.locationCapture, stepUrl: url };
  const html = answerText(resp);
  return captureFrom(pick, html);
}

export default captureLocation;
export { captureLocation };
