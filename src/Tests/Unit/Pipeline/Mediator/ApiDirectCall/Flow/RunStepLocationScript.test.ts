/**
 * The handoff script grammar. The lexer drops comments, reads quoted
 * strings and refuses a template holding `${`; the walker follows only the
 * branch the configured User-Agent selects and accepts there just the seven
 * location assignments, three ignored calls and the `navigator.userAgent`
 * test, nested at most four deep. The other branch is skipped unread.
 */

import { tokenizeScript } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.locationScriptLexer.js';
import { selectedTargets } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.locationScriptWalk.js';

const APP_AGENT = 'Mozilla/5.0 MatafMobile/2.1';
const WEB_AGENT = 'Mozilla/5.0 (research)';
const CHECK = "navigator.userAgent.indexOf('MatafMobile') > -1";

/** One script and the URLs it selects for a User-Agent, or false when refused. */
interface IScriptCase {
  readonly label: string;
  readonly script: string;
  readonly agent?: string;
  readonly expected: readonly string[] | false;
}

/**
 * The URLs a script selects for a User-Agent.
 * @param script - Script body.
 * @param agent - The User-Agent the branches test.
 * @returns Selected URLs, or false when the lexer or the walker refuses.
 */
function targetsOf(script: string, agent: string): readonly string[] | false {
  const tokens = tokenizeScript(script);
  if (tokens === false) return false;
  return selectedTargets(tokens, agent);
}

/**
 * Nest `if` statements on the bank's check around one assignment.
 * @param depth - How many `if` statements.
 * @returns Script text.
 */
function nested(depth: number): string {
  const opens = `if (${CHECK}) { `.repeat(depth);
  return `${opens}location = '/deep';${' }'.repeat(depth)}`;
}

const TARGETS = [
  'location',
  'window.location',
  'window.location.href',
  'document.location',
  'document.location.href',
  'top.location',
  'top.location.href',
];

const BRANCHES = `if (${CHECK}) { window.parent.postMessage({ a: [1] }, '*'); } else { location = '/web'; }`;

const ACCEPTED: readonly IScriptCase[] = [
  { label: 'a double-quoted URL', script: 'location = "/a";', expected: ['/a'] },
  { label: 'a last statement with no semicolon', script: "location = '/a'", expected: ['/a'] },
  {
    label: 'statements split by a line break',
    script: "console.log('x')\nlocation = '/a'",
    expected: ['/a'],
  },
  {
    label: 'ignored calls with any arguments',
    script:
      "sessionStorage.removeItem('k'); localStorage.removeItem(a[0], { b: [1, '(]'] });\nconsole.log(f(g('}')), `t`);",
    expected: [],
  },
  { label: 'the taken branch', script: BRANCHES, agent: WEB_AGENT, expected: ['/web'] },
  {
    label: 'the app branch',
    script: `if (${CHECK}) { location = '/app'; } else { location = '/web'; }`,
    agent: APP_AGENT,
    expected: ['/app'],
  },
  {
    label: 'an if with no else, not taken',
    script: `if (${CHECK}) location = '/app';`,
    expected: [],
  },
  {
    label: 'single-statement branches',
    script: `if (${CHECK}) location = '/app'; else location = '/web';`,
    expected: ['/web'],
  },
  {
    label: 'single-statement branches split by a line break',
    script: `if (${CHECK}) window.parent.postMessage('x', '*')\nelse location = '/web'`,
    expected: ['/web'],
  },
  {
    label: 'a dangling else on the inner if',
    script: `if (navigator.userAgent.indexOf('Mozilla') > -1) if (${CHECK}) location = '/app'; else location = '/web';`,
    expected: ['/web'],
  },
  {
    label: 'a skipped if holding the dangling else',
    script: `if (${CHECK}) if (x) a(); else b(); location = '/after';`,
    expected: ['/after'],
  },
  { label: 'ifs nested four deep', script: nested(4), agent: APP_AGENT, expected: ['/deep'] },
  {
    label: 'comments',
    script: "// location = '/x'\n/* location = '/y' */ location = '/a'; // tail",
    expected: ['/a'],
  },
  {
    label: 'a block comment holding a line break',
    script: "console.log(1) /* \n */ location = '/a'",
    expected: ['/a'],
  },
  { label: 'a URL holding //', script: "location = '/a//b?c=1';", expected: ['/a//b?c=1'] },
  { label: 'escaped slashes', script: "location = '\\/a\\/b';", expected: ['/a/b'] },
  { label: 'escaped quotes', script: 'location = "/a\\"b\\\'c\\\\";', expected: ['/a"b\'c\\'] },
  { label: 'two assignments', script: "location = '/a'; location = '/b';", expected: ['/a', '/b'] },
  { label: 'an empty script', script: ' \n ', expected: [] },
];

const REFUSED: readonly IScriptCase[] = [
  { label: 'a template holding ${', script: 'console.log(`${a}`);', expected: false },
  { label: 'a template URL', script: 'location = `/a`;', expected: false },
  { label: 'a newline escape', script: "location = '/a\\n';", expected: false },
  { label: 'a hex escape', script: "location = '\\x2fa';", expected: false },
  { label: 'a line continuation', script: "location = '/a\\\nb';", expected: false },
  { label: 'an unterminated string', script: "location = '/a;", expected: false },
  { label: 'an unterminated comment', script: "location = '/a'; /* x", expected: false },
  { label: 'another statement', script: "var x = 1; location = '/a';", expected: false },
  { label: 'a location call', script: "location.replace('/a');", expected: false },
  { label: 'location.href', script: "location.href = '/a';", expected: false },
  { label: 'two statements on a line', script: "console.log(1) location = '/a'", expected: false },
  { label: 'a joined URL', script: "location = '/a' + x;", expected: false },
  { label: 'a comparison', script: "location == '/a';", expected: false },
  { label: 'an empty statement', script: ";location = '/a';", expected: false },
  { label: 'a bare block', script: "{ location = '/a'; }", expected: false },
  { label: 'a selected postMessage', script: BRANCHES, agent: APP_AGENT, expected: false },
  { label: 'ifs nested five deep', script: nested(5), agent: APP_AGENT, expected: false },
  { label: 'another condition', script: "if (x) location = '/a';", expected: false },
  {
    label: 'a different comparison',
    script: "if (navigator.userAgent.indexOf('A') >= 0) location = '/a';",
    expected: false,
  },
  {
    label: 'an empty marker',
    script: "if (navigator.userAgent.indexOf('') > -1) location = '/a';",
    expected: false,
  },
  {
    label: 'a marker over 64 chars',
    script: `if (navigator.userAgent.indexOf('${'m'.repeat(65)}') > -1) location = '/a';`,
    expected: false,
  },
  {
    label: 'an else on the same line with no semicolon',
    script: `if (${CHECK}) location = '/app' else location = '/web'`,
    expected: false,
  },
  {
    label: 'a skipped branch running into its else',
    script: `if (${CHECK}) a() else location = '/web'`,
    expected: false,
  },
  {
    label: 'an unbalanced skipped branch',
    script: `if (${CHECK}) { a(; location = '/a';`,
    expected: false,
  },
  {
    label: 'an unclosed taken block',
    script: `if (${CHECK}) {`,
    agent: APP_AGENT,
    expected: false,
  },
];

describe('handoff script grammar', () => {
  it.each(TARGETS)('selects an assignment to %s', target => {
    const result = targetsOf(`${target} = '/home';`, WEB_AGENT);
    expect(result).toEqual(['/home']);
  });

  it.each(ACCEPTED)('accepts $label', ({ script, agent, expected }) => {
    const result = targetsOf(script, agent ?? WEB_AGENT);
    expect(result).toEqual(expected);
  });

  it.each(REFUSED)('refuses $label', ({ script, agent, expected }) => {
    const result = targetsOf(script, agent ?? WEB_AGENT);
    expect(result).toBe(expected);
  });

  it('accepts a marker of 64 chars', () => {
    const marker = 'm'.repeat(64);
    const script = `if (navigator.userAgent.indexOf('${marker}') > -1) location = '/a';`;
    const result = targetsOf(script, marker);
    expect(result).toEqual(['/a']);
  });
});
