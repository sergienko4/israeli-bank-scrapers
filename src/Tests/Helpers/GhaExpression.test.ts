/**
 * GhaExpression — the `if:` evaluator the workflow-wiring suites run real
 * conditions through. A wrong evaluator would let a wiring test pass on a
 * condition GitHub reads differently, so its semantics are pinned here.
 *
 * Rules:
 *   GHX-1  a condition naming no status function runs as `success() && (…)`
 *   GHX-2  naming any status function opts out of the implicit `success()`
 *   GHX-3  precedence: `!` > `==` / `!=` > `&&` > `||`; parentheses group
 *   GHX-4  strings compare case-insensitively; `''` escapes a quote
 *   GHX-5  `&&` and `||` short-circuit
 *   GHX-6  a `${{ … }}` wrapper reads the same as the bare condition
 *   GHX-7  any syntax, lookup, function or comparison it does not model throws
 *   GHX-8  the job-level status follows the needed jobs and the run
 */

import type { IGhaContext, INeed } from './GhaExpression.js';
import { evaluateIf, jobStatus, namesStatusFunction } from './GhaExpression.js';

const OUTPUTS = { on: 'true', off: 'false', blank: '', mixed: 'TrUe' };

/**
 * A needed job.
 *
 * @param result - Its result.
 * @returns The job, with the shared outputs.
 */
function need(result: string): INeed {
  return { result, outputs: OUTPUTS };
}

/**
 * A context with one need, `a`.
 *
 * @param result - The result of `a`.
 * @param isCancelled - Whether the run was cancelled.
 * @returns The context.
 */
function contextWith(result: string, isCancelled = false): IGhaContext {
  const needs = { a: need(result) };
  const status = jobStatus(needs, isCancelled);
  return { needs, status };
}

const SUCCEEDED = contextWith('success');
const FAILED = contextWith('failure');
const SKIPPED = contextWith('skipped');
const CANCELLED = contextWith('success', true);

describe('GhaExpression', () => {
  it.each([
    ['all needs succeeded', SUCCEEDED, true],
    ['a need failed', FAILED, false],
    ['a need was skipped', SKIPPED, false],
    ['the run was cancelled', CANCELLED, false],
  ])('[GHX-1] adds success() when %s', (_name, context, expected) => {
    const isRun = evaluateIf("needs.a.outputs.on == 'true'", context);
    expect(isRun).toBe(expected);
  });

  it.each([
    ['!cancelled() && needs.a.outputs.on', SKIPPED, true],
    ['!cancelled() && needs.a.outputs.on', CANCELLED, false],
    ['always()', CANCELLED, true],
    ['failure()', FAILED, true],
    ['failure()', SKIPPED, false],
    ['cancelled()', CANCELLED, true],
    ['success()', SKIPPED, false],
  ])('[GHX-2] %s opts out of the implicit success()', (source, context, expected) => {
    const isRun = evaluateIf(source, context);
    const isOptedOut = namesStatusFunction(source);
    expect(isRun).toBe(expected);
    expect(isOptedOut).toBe(true);
  });

  it('[GHX-2] a condition with no status function does not opt out', () => {
    const isOptedOut = namesStatusFunction("needs.a.result == 'success' || false");
    expect(isOptedOut).toBe(false);
  });

  it.each([
    ["'a' == 'b' || 'c' == 'c' && 'd' == 'd'", true],
    ["('a' == 'b' || 'c' == 'c') && 'd' == 'e'", false],
    ['!needs.a.outputs.blank == true', true],
    ['!(needs.a.outputs.on == needs.a.outputs.off)', true],
    ["needs.a.outputs.on != 'false' && !false", true],
    ['needs.a.outputs.blank || needs.a.outputs.off', true],
    ['needs.a.outputs.blank', false],
  ])('[GHX-3] %s is %s', (source, expected) => {
    const isRun = evaluateIf(source, SUCCEEDED);
    expect(isRun).toBe(expected);
  });

  it.each([
    ["needs.a.outputs.mixed == 'true'", true],
    ["needs.a.result == 'SUCCESS'", true],
    ["'it''s' == 'IT''S'", true],
    ["'it''s' == 'its'", false],
  ])('[GHX-4] %s is %s', (source, expected) => {
    const isRun = evaluateIf(source, SUCCEEDED);
    expect(isRun).toBe(expected);
  });

  it.each([
    ["false && needs.ghost.result == 'x'", false],
    ["true || needs.ghost.result == 'x'", true],
  ])('[GHX-5] %s never reads its right side', (source, expected) => {
    const isRun = evaluateIf(source, SUCCEEDED);
    expect(isRun).toBe(expected);
  });

  it('[GHX-5] a failed implicit success() never reads the condition', () => {
    const isRun = evaluateIf("needs.ghost.result == 'x'", FAILED);
    expect(isRun).toBe(false);
  });

  it.each([
    ["${{ needs.a.outputs.on == 'true' }}", SUCCEEDED, true],
    ["${{ !cancelled() && needs.a.outputs.on == 'true' }}", SKIPPED, true],
    ["  ${{ needs.a.outputs.on == 'true' }}  ", FAILED, false],
  ])('[GHX-6] %s reads as its bare form', (source, context, expected) => {
    const isRun = evaluateIf(source, context);
    expect(isRun).toBe(expected);
  });

  it.each([
    ['an unknown job', "needs.ghost.result == 'success'", RangeError],
    ['an unknown output', "needs.a.outputs.ghost == 'true'", RangeError],
    ['an unknown field', "needs.a.status == 'success'", RangeError],
    ['a path past result', "needs.a.result.x == 'success'", RangeError],
    ['a non-needs context', "github.event_name == 'push'", RangeError],
    ['a mixed-type comparison', 'needs.a.outputs.on == true', RangeError],
    ['an unmodelled function', "contains(needs.a.result, 'succ')", SyntaxError],
    ['an unmodelled operator', "needs.a.result > 'a'", SyntaxError],
    ['an unclosed parenthesis', "(needs.a.result == 'success'", SyntaxError],
    ['a dangling operand', "needs.a.result 'success'", SyntaxError],
    ['an empty condition', '', SyntaxError],
  ])('[GHX-7] throws on %s', (_name, source, error) => {
    expect(() => evaluateIf(source, SUCCEEDED)).toThrow(error);
  });

  it.each([
    [['success', 'success'], false, { success: true, failure: false, cancelled: false }],
    [['success', 'skipped'], false, { success: false, failure: false, cancelled: false }],
    [['failure', 'success'], false, { success: false, failure: true, cancelled: false }],
    [['success', 'success'], true, { success: false, failure: false, cancelled: true }],
  ])('[GHX-8] needs %j, cancelled %s → %j', (results, isCancelled, expected) => {
    const rows = results.map((result, index) => [`j${String(index)}`, need(result)] as const);
    const needs = Object.fromEntries(rows);
    const status = jobStatus(needs, isCancelled);
    expect(status).toStrictEqual(expected);
  });
});
