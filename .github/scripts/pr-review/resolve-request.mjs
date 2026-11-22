import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { canRequest, githubRequest, isTrustedAssociation, readResponseJson } from './shared.mjs';

/** Exact PR comment trigger, with an optional approve command and model. */
const REVIEW_COMMAND =
  /^\/review(?<approve>[ \t]+approve)?(?:[ \t]+model=(?<model>[A-Za-z0-9./#_-]+))?[ \t]*$/u;

/** Effort order used when a model has no configured default. */
const VARIANT_PRIORITY = ['high', 'max', 'low'];

/** Public OpenCode Go model catalog; constants keep file data out of the URL. */
const MODELS_URL = 'https://opencode.ai/inference/go/v1/models';

/** Catalog deadline; the pinned fallback matters more than a slow lookup. */
const CATALOG_TIMEOUT_MS = 5000;

/**
 * Read the event payload from the path GitHub supplies.
 * @param {NodeJS.ProcessEnv} env - Process environment.
 * @returns {Promise<Record<string, unknown>>} Parsed event.
 */
async function readEvent(env) {
  if (!env.GITHUB_EVENT_PATH) throw new Error('GITHUB_EVENT_PATH is missing');
  return JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8'));
}

/**
 * Parse the trigger into a PR number and optional model text.
 * @param {string} eventName - GitHub event name.
 * @param {Record<string, unknown>} event - Event payload.
 * @returns {{ pr: number, modelInput: string, actor: string, association: string, source: string, command: string }} Request.
 */
export function parseRequest(eventName, event) {
  if (eventName === 'workflow_dispatch') {
    const inputs = /** @type {Record<string, unknown>} */ (event.inputs ?? {});
    const pr = Number(inputs.pr);
    return {
      pr,
      modelInput: String(inputs.model ?? ''),
      actor: '',
      association: 'OWNER',
      source: 'workflow_dispatch',
      command: 'review',
    };
  }
  if (eventName !== 'issue_comment') throw new Error('unsupported event');
  const issue = /** @type {Record<string, unknown>} */ (event.issue ?? {});
  const comment = /** @type {Record<string, unknown>} */ (event.comment ?? {});
  if (issue.pull_request === undefined) throw new Error('not a pull request');
  const body = String(comment.body ?? '');
  const match = REVIEW_COMMAND.exec(body);
  if (match === null) throw new Error('not a review request');
  const user = /** @type {Record<string, unknown>} */ (comment.user ?? {});
  return {
    pr: Number(issue.number),
    modelInput: String(match.groups?.model ?? ''),
    actor: String(user.login ?? ''),
    association: String(comment.author_association ?? ''),
    source: 'issue_comment',
    command: match.groups?.approve === undefined ? 'review' : 'approve',
  };
}

/**
 * Convert catalog entries to the allow-list shape.
 * @param {Array<Record<string, unknown>>} entries - API model entries.
 * @param {Record<string, unknown>} config - Review-agent config.
 * @returns {Array<Record<string, unknown>>} DeepSeek models.
 */
export function catalogModels(entries, config) {
  const prefix = String(config.modelPrefix ?? 'deepseek');
  return entries
    .filter(entry => String(entry.id ?? '').startsWith(prefix))
    .map(entry => {
      const capabilities = /** @type {Record<string, unknown>} */ (entry.capabilities ?? {});
      const reasoning = /** @type {Record<string, unknown>} */ (capabilities.reasoning ?? {});
      const variants = Array.isArray(reasoning.effort) ? reasoning.effort.map(String) : [];
      const released = Date.parse(String(entry.release_date ?? '')) || Number(entry.created ?? 0);
      return {
        id: `${config.provider}/${String(entry.id)}`,
        variants: variants.length > 0 ? variants : ['high'],
        released,
      };
    });
}

/**
 * Use the configured fallback list when discovery is unavailable.
 * @param {Record<string, unknown>} config - Review-agent config.
 * @returns {Array<Record<string, unknown>>} Fallback models.
 */
function fallbackCatalog(config) {
  const fallback = /** @type {Array<Record<string, unknown>>} */ (config.fallbackModels ?? []);
  return fallback.map(entry => ({
    id: `${config.provider}/${String(entry.id)}`,
    variants: Array.isArray(entry.variants) ? entry.variants.map(String) : ['high'],
    released: 0,
  }));
}

/**
 * Discover the current DeepSeek catalog, falling back to the pinned list.
 * @param {object} args - Discovery arguments.
 * @param {Record<string, unknown>} args.config - Review-agent config.
 * @param {typeof fetch} [args.fetchImpl] - Test double.
 * @returns {Promise<Array<Record<string, unknown>>>} Models.
 */
export async function loadCatalog(args) {
  try {
    const response = await (args.fetchImpl ?? fetch)(MODELS_URL, {
      headers: { Accept: 'application/json', 'User-Agent': 'israeli-bank-scrapers-review-agent' },
      signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error('model catalog unavailable');
    const body = /** @type {Record<string, unknown>} */ (await response.json());
    const entries = /** @type {Array<Record<string, unknown>>} */ (body.data ?? []);
    const models = catalogModels(entries, args.config);
    if (models.length > 0) return models;
  } catch {
    // Fall through to the pinned list; the request still works offline.
  }
  return fallbackCatalog(args.config);
}

/**
 * Pick the newest DeepSeek model.
 * @param {Array<Record<string, unknown>>} models - Models.
 * @returns {Record<string, unknown>} Newest model.
 */
function newestModel(models) {
  return models.reduce((best, model) =>
    Number(model.released ?? 0) > Number(best.released ?? 0) ? model : best,
  );
}

/**
 * Choose the variant for one model.
 * @param {Record<string, unknown>} model - Model.
 * @param {string | undefined} requested - Explicit variant.
 * @param {Record<string, unknown>} config - Review-agent config.
 * @returns {string} Variant.
 */
function variantOf(model, requested, config) {
  const variants = /** @type {string[]} */ (model.variants ?? []);
  if (requested !== undefined) {
    if (!variants.includes(requested)) throw new Error('model variant is not allowed');
    return requested;
  }
  const preferred = String(config.defaultVariant ?? 'high');
  if (variants.includes(preferred)) return preferred;
  const priority = /** @type {string[]} */ (config.variantPriority ?? VARIANT_PRIORITY);
  return priority.find(variant => variants.includes(variant)) ?? variants[0] ?? 'high';
}

/**
 * Normalize a model selector against the discovered DeepSeek catalog.
 * @param {string} input - Requested model, or empty for auto.
 * @param {Record<string, unknown>} config - Review-agent config.
 * @param {Array<Record<string, unknown>>} models - Discovered models.
 * @returns {string} Canonical `provider/model#variant`.
 */
export function normalizeModel(input, config, models) {
  if (models.length === 0) throw new Error('no DeepSeek models available');
  const requested = input.trim() || 'auto';
  if (requested === 'auto') {
    const newest = newestModel(models);
    return `${newest.id}#${variantOf(newest, undefined, config)}`;
  }
  const [providerModel, variantText] = requested.split('#', 2);
  const [provider, modelId] = providerModel.includes('/')
    ? providerModel.split('/', 2)
    : [String(config.provider), providerModel];
  if (provider !== config.provider) throw new Error('model provider is not allowed');
  const model = models.find(entry => entry.id === `${config.provider}/${modelId}`);
  if (model === undefined) throw new Error('model is not allowed');
  return `${model.id}#${variantOf(model, variantText, config)}`;
}

/**
 * Fetch the actor's repository permission.
 * @param {object} args - Lookup arguments.
 * @param {string} args.repo - `owner/name`.
 * @param {string} args.actor - GitHub login.
 * @param {string} args.token - GitHub token.
 * @param {typeof fetch} [args.fetchImpl] - Test double.
 * @returns {Promise<string>} Permission name, or ''.
 */
async function actorPermission(args) {
  const response = await githubRequest({
    token: args.token,
    path: `/repos/${args.repo}/collaborators/${encodeURIComponent(args.actor)}/permission`,
    fetchImpl: args.fetchImpl,
  });
  if (response.status === 404) return '';
  const body = /** @type {Record<string, unknown>} */ (await readResponseJson(response));
  return String(body.permission ?? '');
}

/**
 * Fetch the pull request and refuse one that is not same-repo and open.
 * @param {object} args - Lookup arguments.
 * @param {string} args.repo - `owner/name`.
 * @param {number} args.pr - Pull request number.
 * @param {string} args.token - GitHub token.
 * @param {typeof fetch} [args.fetchImpl] - Test double.
 * @returns {Promise<Record<string, unknown>>} Pull request payload.
 */
async function openSameRepoPr(args) {
  const response = await githubRequest({
    token: args.token,
    path: `/repos/${args.repo}/pulls/${args.pr}`,
    fetchImpl: args.fetchImpl,
  });
  const pr = /** @type {Record<string, unknown>} */ (await readResponseJson(response));
  const head = /** @type {Record<string, unknown>} */ (pr.head ?? {});
  const headRepo = /** @type {Record<string, unknown>} */ (head.repo ?? {});
  if (pr.state !== 'open') throw new Error('pull request is not open');
  if (headRepo.full_name !== args.repo) throw new Error('fork pull request is not supported');
  return pr;
}

/**
 * Resolve one review request into workflow outputs.
 * @param {object} args - Request arguments.
 * @param {string} args.eventName - GitHub event name.
 * @param {Record<string, unknown>} args.event - Event payload.
 * @param {string} args.repo - `owner/name`.
 * @param {string} args.token - GitHub token.
 * @param {Record<string, unknown>} args.config - Review-agent config.
 * @param {typeof fetch} [args.fetchImpl] - Test double.
 * @returns {Promise<Record<string, unknown>>} Resolution.
 */
export async function resolveRequest(args) {
  const denied = reason => ({ allowed: false, reason });
  let request;
  try {
    request = parseRequest(args.eventName, args.event);
  } catch (error) {
    return denied(error.message);
  }
  if (!Number.isInteger(request.pr) || request.pr <= 0) return denied('invalid pull request');
  if (!isTrustedAssociation(request.association)) return denied('actor is not a maintainer');
  let model;
  try {
    const models = await loadCatalog(args);
    model = normalizeModel(request.modelInput, args.config, models);
  } catch (error) {
    return denied(error.message);
  }
  try {
    const permission = await actorPermission({ ...args, actor: request.actor });
    if (request.source === 'issue_comment' && !canRequest(permission)) {
      return denied('actor is not a maintainer');
    }
    const pr = await openSameRepoPr({ ...args, pr: request.pr });
    const base = /** @type {Record<string, unknown>} */ (pr.base ?? {});
    const head = /** @type {Record<string, unknown>} */ (pr.head ?? {});
    return {
      allowed: true,
      reason: '',
      pr: request.pr,
      model,
      actor: request.actor,
      baseSha: String(base.sha ?? ''),
      headSha: String(head.sha ?? ''),
      headRef: String(head.ref ?? ''),
      source: request.source,
      command: request.command,
    };
  } catch (error) {
    return denied(error.message);
  }
}

/**
 * Write GitHub Actions outputs.
 * @param {Record<string, unknown>} resolution - Resolution.
 * @param {NodeJS.ProcessEnv} env - Process environment.
 * @returns {Promise<void>} Resolves when written.
 */
async function writeOutputs(resolution, env) {
  if (!env.GITHUB_OUTPUT) {
    console.log(JSON.stringify(resolution));
    return;
  }
  const lines = Object.entries(resolution).map(([key, value]) => `${key}=${String(value)}`);
  const { appendFile } = await import('node:fs/promises');
  await appendFile(env.GITHUB_OUTPUT, `${lines.join('\n')}\n`, 'utf8');
}

/**
 * CLI entrypoint.
 * @returns {Promise<void>} Resolves when the request is resolved.
 */
async function main() {
  const env = process.env;
  const config = JSON.parse(
    await readFile(new URL('../../review-agent/config.json', import.meta.url), 'utf8'),
  );
  const event = await readEvent(env);
  const resolution = await resolveRequest({
    eventName: env.GITHUB_EVENT_NAME ?? '',
    event,
    repo: env.GITHUB_REPOSITORY ?? '',
    token: env.GITHUB_TOKEN ?? '',
    config,
  });
  await writeOutputs(resolution, env);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`pr-review resolve failed: ${error.name}`);
    process.exitCode = 1;
  });
}
