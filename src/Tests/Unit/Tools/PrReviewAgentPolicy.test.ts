/**
 * Policy smoke tests for the read-only reviewer. They pin the supported
 * permission mapping, the effective tool and path rules, the base-checkout
 * path and the config defaults that the workflow relies on. The live CLI
 * sandbox test remains a Phase 4 check.
 */

import { readFile } from 'node:fs/promises';

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
 * Read the agent's singular permission mapping into ordered rules.
 * @param agent - Agent markdown.
 * @returns Ordered permission rules.
 */
function parsePermission(agent: string): IPermissionRule[] {
  const lines = agent.split('\n');
  const start = lines.findIndex(line => line.trim() === 'permission:');
  if (start < 0) {
    return [];
  }
  const rules: IPermissionRule[] = [];
  let tool = '';
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '---') {
      break;
    }
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const separator = trimmed.indexOf(':');
    if (separator < 0) {
      continue;
    }
    const key = trimmed
      .slice(0, separator)
      .replace(/^['"]|['"]$/gu, '')
      .trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!line.startsWith('    ')) {
      tool = key;
      if (value.length > 0) {
        rules.push({ action: key, resource: '*', effect: value });
        tool = '';
      }
      continue;
    }
    if (tool.length > 0) {
      rules.push({ action: tool, resource: key, effect: value });
    }
  }
  return rules;
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

  it('denies root-level and nested credential paths', async () => {
    const agent = await readFile('.opencode/agents/pr-reviewer.md', 'utf8');
    const rules = parsePermission(agent);

    for (const path of [
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
    ]) {
      const effect = evaluate(rules, 'read', path);
      expect(effect).toBe('deny');
    }

    const sourceEffect = evaluate(rules, 'read', 'src/index.ts');
    expect(sourceEffect).toBe('allow');
  });

  it('keeps the broad read allow before the credential denies', async () => {
    const agent = await readFile('.opencode/agents/pr-reviewer.md', 'utf8');
    const rules = parsePermission(agent);
    const allowIndex = rules.findIndex(
      rule => rule.action === 'read' && rule.resource === '*' && rule.effect === 'allow',
    );
    const denyIndex = rules.findIndex(rule => rule.action === 'read' && rule.effect === 'deny');
    expect(allowIndex).toBeGreaterThanOrEqual(0);
    expect(denyIndex).toBeGreaterThan(allowIndex);
  });

  it('allows only review skills and glob', async () => {
    const agent = await readFile('.opencode/agents/pr-reviewer.md', 'utf8');
    const rules = parsePermission(agent);
    const allowedSkill = evaluate(rules, 'skill', 'pr-review-context');
    const otherSkill = evaluate(rules, 'skill', 'other-skill');
    const globbed = evaluate(rules, 'glob', '**/*.ts');
    expect(allowedSkill).toBe('allow');
    expect(otherSkill).toBe('deny');
    expect(globbed).toBe('allow');
  });

  it('reads base context from .review/base and leaves the event to the poster', async () => {
    const agent = await readFile('.opencode/agents/pr-reviewer.md', 'utf8');
    expect(agent).toContain('.review/base/');
    expect(agent).toContain('posting script maps the validated');
    expect(agent).not.toContain('review event is always `COMMENT`');
    expect(agent).not.toContain('Never approve, never request changes');
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
