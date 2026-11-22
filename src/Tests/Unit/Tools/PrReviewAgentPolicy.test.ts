/**
 * Policy smoke tests for the read-only reviewer. They pin the supported
 * permission mapping, the effective tool and path rules, the base-checkout
 * path and the config defaults that the workflow relies on. The live CLI
 * sandbox test remains a Phase 4 check.
 */

import { readFile } from 'node:fs/promises';

import { parse } from 'yaml';

/** One ordered permission rule. */
interface IPermissionRule {
  /** Tool action, or `*` for every tool. */
  readonly action: string;
  /** Resource pattern, or `*` for every resource. */
  readonly resource: string;
  /** `allow`, `deny` or `ask`. */
  readonly effect: string;
}

/**
 * Match one value with OpenCode v2.2.5's wildcard matcher.
 * `*` and `?` cross directory separators; there is no separate `**` token.
 * @param input - Value to match.
 * @param pattern - Wildcard pattern.
 * @returns True when the pattern matches.
 */
function wildcardMatch(input: string, pattern: string): boolean {
  const normalized = input.replaceAll('\\', '/');
  let escaped = pattern
    .replaceAll('\\', '/')
    .replace(/[.+^${}()|[\]\\]/gu, '\\$&')
    .replace(/\*/gu, '.*')
    .replace(/\?/gu, '.');
  if (escaped.endsWith(' .*')) {
    escaped = `${escaped.slice(0, -3)}( .*)?`;
  }
  return new RegExp(`^${escaped}$`, 'su').test(normalized);
}

/**
 * Parse an agent's singular permission mapping from its frontmatter.
 * @param agent - Agent markdown.
 * @returns Ordered permission rules.
 */
function parsePermission(agent: string): IPermissionRule[] {
  const match = /^---\n([\s\S]*?)\n---/u.exec(agent);
  if (match === null) {
    return [];
  }
  const frontmatter = parse(match[1]) as {
    permission?: Record<string, string | Record<string, string>>;
  };
  const permission = frontmatter.permission ?? {};
  const rules: IPermissionRule[] = [];
  for (const [action, rule] of Object.entries(permission)) {
    if (typeof rule === 'string') {
      rules.push({ action, resource: '*', effect: rule });
      continue;
    }
    for (const [resource, effect] of Object.entries(rule)) {
      rules.push({ action, resource, effect });
    }
  }
  return rules;
}

/**
 * Read and parse the reviewer agent's permission rules.
 * @returns Ordered permission rules.
 */
async function loadRules(): Promise<IPermissionRule[]> {
  const agent = await readFile('.opencode/agents/pr-reviewer.md', 'utf8');
  return parsePermission(agent);
}

/**
 * Evaluate a request with OpenCode's last-match-wins rule.
 * @param rules - Ordered permission rules.
 * @param action - Tool action.
 * @param resource - Tool resource.
 * @returns The effective effect.
 */
function evaluate(rules: IPermissionRule[], action: string, resource: string): string {
  for (let index = rules.length - 1; index >= 0; index -= 1) {
    const rule = rules[index];
    if (wildcardMatch(action, rule.action) && wildcardMatch(resource, rule.resource)) {
      return rule.effect;
    }
  }
  return 'ask';
}

const CREDENTIAL_PATHS = [
  '.env',
  'nested/.env.local',
  'service.key',
  'certs/service.pem',
  'id_rsa',
  'nested/id_rsa.pub',
  '.npmrc',
  'config/.netrc',
  '.git-credentials',
  'nested/.git-credentials',
  'store.p12',
  'store.jks',
];

const STAGED_PATHS = [
  '.review/pr/metadata.json',
  '.review/pr/base-rules/AGENTS.review.txt',
  '.review/base/src/a.ts',
  '.review-guidelines/manifest.json',
  '.github/review-agent/overlays/israeli-bank-scrapers.md',
];

const STAGED_CREDENTIAL_PATHS = [
  '.review/base/.env',
  '.review/base/nested/.env.local',
  '.review/base/service.key',
  '.review/base/certs/service.pem',
  '.review/base/.git-credentials',
  '.review/pr/base-rules/.env',
];

describe('PR reviewer tool policy', () => {
  it('uses the supported permission mapping and denies every other tool', async () => {
    const agent = await readFile('.opencode/agents/pr-reviewer.md', 'utf8');
    const rules = parsePermission(agent);
    expect(agent).toContain('\npermission:\n');
    expect(agent).not.toContain('\npermissions:\n');
    expect(rules[0]).toEqual({ action: '*', resource: '*', effect: 'deny' });

    const allowedRules = rules.filter(rule => rule.effect === 'allow');
    const allowedActions = allowedRules.map(rule => rule.action);
    const allowed = new Set(allowedActions);
    expect(allowed).toEqual(new Set(['read', 'glob', 'skill']));

    for (const action of ['bash', 'edit', 'write', 'webfetch']) {
      const effect = evaluate(rules, action, 'anything');
      expect(effect).toBe('deny');
    }
  });

  it('uses the CLI wildcard semantics across directories', () => {
    const isSourceMatch = wildcardMatch('src/index.ts', '*.ts');
    const isQuestionMatch = wildcardMatch('src/a.ts', 'src/?.ts');
    const isStarMatch = wildcardMatch('src/a.ts', 'src/*.ts');
    expect(isSourceMatch).toBe(true);
    expect(isQuestionMatch).toBe(true);
    expect(isStarMatch).toBe(true);
  });

  it.each(CREDENTIAL_PATHS)('denies credential path %s', async path => {
    const rules = await loadRules();
    const effect = evaluate(rules, 'read', path);
    expect(effect).toBe('deny');
  });

  it.each(STAGED_PATHS)('allows staged path %s', async path => {
    const rules = await loadRules();
    const effect = evaluate(rules, 'read', path);
    expect(effect).toBe('allow');
  });

  it.each(STAGED_CREDENTIAL_PATHS)('denies staged credential path %s', async path => {
    const rules = await loadRules();
    const effect = evaluate(rules, 'read', path);
    expect(effect).toBe('deny');
  });

  it('denies workspace-root source paths', async () => {
    const rules = await loadRules();
    const effect = evaluate(rules, 'read', 'src/index.ts');
    expect(effect).toBe('deny');
  });

  it('keeps every read allow before the credential denies', async () => {
    const rules = await loadRules();
    const allowIndexes = rules.flatMap((rule, index) =>
      rule.action === 'read' && rule.effect === 'allow' ? [index] : [],
    );
    const denyIndex = rules.findIndex(rule => rule.action === 'read' && rule.effect === 'deny');
    const lastAllowIndex = Math.max(...allowIndexes);
    expect(lastAllowIndex).toBeGreaterThanOrEqual(0);
    expect(denyIndex).toBeGreaterThan(lastAllowIndex);
  });

  it('allows only review skills and glob', async () => {
    const rules = await loadRules();
    const allowedSkill = evaluate(rules, 'skill', 'pr-review-context');
    const otherSkill = evaluate(rules, 'skill', 'other-skill');
    const globbed = evaluate(rules, 'glob', '**/*.ts');
    expect(allowedSkill).toBe('allow');
    expect(otherSkill).toBe('deny');
    expect(globbed).toBe('allow');
  });

  it('decodes quoted permission values as allows', () => {
    const rules = parsePermission(`---
permission:
  websearch: 'allow'
---`);
    expect(rules).toEqual([{ action: 'websearch', resource: '*', effect: 'allow' }]);
    const allowed = new Set(rules.filter(rule => rule.effect === 'allow').map(rule => rule.action));
    const hasWebsearch = allowed.has('websearch');
    expect(hasWebsearch).toBe(true);
    expect(allowed).not.toEqual(new Set(['read', 'glob', 'skill']));
  });

  it('reads base context from .review/base and leaves the event to the poster', async () => {
    const agent = await readFile('.opencode/agents/pr-reviewer.md', 'utf8');
    expect(agent).toContain('.review/base/');
    expect(agent).toContain('submits a `COMMENT` review');
    expect(agent).not.toContain('review event is always `COMMENT`');
    expect(agent).not.toContain('Never approve, never request changes');
  });

  it('stages the PR base and data-only rules', async () => {
    const workflow = await readFile('.github/workflows/pr-review-agent.yml', 'utf8');
    expect(workflow).toContain('mkdir -p .review/base .review/pr/base-rules');
    expect(workflow).toContain('REVIEW_BASE_SHA:-HEAD');
    expect(workflow).toContain('git archive "$base"');
    expect(workflow).toContain('find .review/base .review-guidelines -type l -delete');
    expect(workflow).toContain('AGENTS.review.txt');
    expect(workflow).toContain('CLAUDE.review.txt');
    expect(workflow).toContain('-name AGENTS.md');
    expect(workflow).toContain('-name CLAUDE.md');
    expect(workflow).toContain('.github/review-agent/overlays/israeli-bank-scrapers.md');
  });
});

describe('PR reviewer config defaults', () => {
  it('keeps no-fork, approval, progress and model defaults explicit', async () => {
    const configText = await readFile('.github/review-agent/config.json', 'utf8');
    const config: unknown = JSON.parse(configText);
    expect(config).toMatchObject({
      defaultReviewEvent: 'COMMENT',
      blockingSeverities: ['critical', 'important'],
      maxFiles: 300,
      appLogin: 'review-agent[bot]',
      approval: { enabled: true, allowAuthor: true },
    });
  });
});
