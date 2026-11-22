/**
 * Policy smoke tests for the read-only reviewer. They pin the tool deny-list,
 * the base-checkout path and the config defaults that the workflow relies on.
 * The live CLI sandbox test remains a Phase 4 check.
 */

import { readFile } from 'node:fs/promises';

/**
 * Match one path with OpenCode's workspace-relative wildcard rules.
 * Double-star crosses directories; a double-star slash needs a real slash;
 * single-star and question mark do not cross one.
 * @param pattern - Permission resource glob.
 * @param path - Workspace-relative path.
 * @returns True when the path matches.
 */
function matchesGlob(pattern: string, path: string): boolean {
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index] ?? '';
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        source += '.*';
        index += 1;
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&');
    }
  }
  return new RegExp(`${source}$`, 'u').test(path);
}

describe('PR reviewer tool policy', () => {
  it('denies every tool and allows only read, glob and the review skills', async () => {
    const agent = await readFile('.opencode/agents/pr-reviewer.md', 'utf8');
    const rules = agent
      .split('- action: ')
      .slice(1)
      .flatMap(chunk => {
        const action = /^'?([A-Za-z*]+)'?/u.exec(chunk)?.[1];
        const resource = /resource: '([^']+)'/u.exec(chunk)?.[1];
        const effect = /effect: ([a-z]+)/u.exec(chunk)?.[1];
        return action === undefined || resource === undefined || effect === undefined
          ? []
          : [{ action, resource, effect }];
      });
    expect(rules).toContainEqual({ action: '*', resource: '*', effect: 'deny' });
    const allowedActions = rules.filter(rule => rule.effect === 'allow').map(rule => rule.action);
    expect(new Set(allowedActions)).toEqual(new Set(['read', 'glob', 'skill']));
    const hasForbiddenAction = rules.some(rule =>
      /^(?:bash|edit|write|webfetch)$/u.test(rule.action),
    );
    expect(hasForbiddenAction).toBe(false);
  });

  it('denies root-level and nested credential paths', async () => {
    const agent = await readFile('.opencode/agents/pr-reviewer.md', 'utf8');
    const denies = [...agent.matchAll(/- action: read\s+resource: '([^']+)'\s+effect: deny/gu)].map(
      match => match[1],
    );
    expect(denies.length).toBeGreaterThan(0);
    for (const path of [
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
      '.env',
      'nested/.env.local',
    ]) {
      const isDenied = denies.some(pattern => matchesGlob(pattern, path));
      expect(isDenied).toBe(true);
    }
    const isNormalSourceDenied = denies.some(pattern => matchesGlob(pattern, 'src/index.ts'));
    expect(isNormalSourceDenied).toBe(false);
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
