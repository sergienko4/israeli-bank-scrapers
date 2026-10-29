/**
 * StaticGateGuard — strips the guard on a `Static checks` gate so suites can
 * read which change flags fire it. A wrong strip would let a flag test pass
 * on a condition GitHub reads differently, so the edges are pinned here.
 */

import gateTrigger from './StaticGateGuard.js';

const GUARD = "!cancelled() && steps.ready.outcome == 'success'";
const TRIGGER =
  "needs.changes.outputs.full_suite == 'true' || needs.changes.outputs.deps == 'true'";

describe('StaticGateGuard', () => {
  it.each([
    ['the guard around one group', `\${{ ${GUARD} && (${TRIGGER}) }}`, TRIGGER],
    ['nested groups inside it', `\${{ ${GUARD} && ((a) || (b)) }}`, '(a) || (b)'],
  ])('[SGG-1] returns the trigger of %s', (_name, condition, expected) => {
    const trigger = gateTrigger(condition);
    expect(trigger).toBe(expected);
  });

  it.each([
    ['an unguarded condition', TRIGGER],
    ['the guard without a wrapper', `${GUARD} && (${TRIGGER})`],
    ['two groups at the top level', `\${{ ${GUARD} && (a) || (b) }}`],
    ['another guard', `\${{ always() && (${TRIGGER}) }}`],
  ])('[SGG-2] returns %s unchanged', (_name, condition) => {
    const trigger = gateTrigger(condition);
    expect(trigger).toBe(condition);
  });
});
