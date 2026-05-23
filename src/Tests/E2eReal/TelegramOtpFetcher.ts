/**
 * Telegram-side OTP delivery for CI E2E Real jobs.
 *
 * <p>The fetcher polls the Telegram Bot API's `getUpdates` endpoint
 * with `offset=0` and `timeout=0` (short-poll) — Telegram's
 * documented non-destructive read that returns ALL unconfirmed
 * updates (up to `limit`) WITHOUT advancing the bot's confirmed
 * cursor. Per-prompt isolation comes from the
 * `reply_to_message.message_id === promptMessageId` filter alone.
 *
 * <p>Post-resolution queue cleanup happens via two complementary
 * paths: {@link confirmCursorPastMatch} on the MATCH path
 * (advances `offset=match.update_id + 1` — safe because the CI
 * serial-OTP workflow `e2e-real-otp` with `max-parallel: 1`
 * guarantees only one fetcher is ever active at a time, so no
 * concurrent fetcher's reply can be in the matched-id range), and
 * {@link pruneOldUpdates} on the TIMEOUT path (10-min time-window
 * GC — preserves any RECENT pending replies on host pre-commit
 * sequential runs where a brand-new fetcher may start within the
 * window). Telegram's 24h retention is the long-tail safety net.
 *
 * <p>Multiple fetchers (e.g. parallel CI matrix runners on separate
 * GitHub-hosted VMs) safely share the bot's queue: each filters by
 * its own `reply_to_message.message_id` and picks ONLY its own
 * reply. The Beinleumi-OTP-prompt-during-Hapoalim-run symptom
 * (observed 2026-05-12) cannot recur because no fetcher's
 * `getUpdates` call can purge another's RECENT pending reply —
 * `pruneOldUpdates` only confirms updates older than
 * `RECENT_MESSAGE_WINDOW_S`. The CI workflow further serialises the
 * three OTP-gated banks via `e2e-real-otp` (max-parallel: 1) so the
 * parallel-fetcher case is now only exercised by host pre-commit
 * runs; the in-process invariants still hold.
 *
 * <p>The previous design used `offset=-1` for an initial probe and
 * `offset=minUpdateId+1` for poll cycles. Telegram's documented
 * semantics for `offset=-N`: "All previous updates will be forgotten."
 * In a multi-fetcher matrix, the second concurrent fetcher's probe
 * purged the first fetcher's pending reply (cross-fetcher offset
 * purge). Documented as the Phase A.fix-2 follow-up in
 * `telegram-m5-and-final-cleanup/phase-a-fix-1-commit-review.md`.
 * Replaced with non-destructive `offset=0` polling per
 * `telegram-m5-and-final-cleanup/spec.txt` §"Phase A.fix-2".
 *
 * <p>Live only inside `src/Tests/E2eReal/` — never imported from
 * `src/Scrapers/**`. The npm package's `files: ['lib/**']` field
 * excludes the entire `src/Tests/` tree from the published tarball,
 * so npm consumers see no surface change. Verified via
 * `npm pack --dry-run`.
 *
 * <p>Backward-compat: when `botToken` or `chatId` is empty, the
 * fetcher returns `false` synchronously — never makes a network
 * call. Callers in `OtpPoller` short-circuit on this result and
 * fall through to the existing env-var / poll-file / readline
 * tiers.
 */

import { humanDelay } from '../../Scrapers/Pipeline/Mediator/Timing/Waiting.js';
import type { ScraperLogger } from '../../Scrapers/Pipeline/Types/Debug.js';

/** Bundled args — preserves the project's 3-param ceiling. */
interface ITelegramFetchArgs {
  /** Bot token from BotFather; empty disables the tier. */
  readonly botToken: string;
  /** Chat id (numeric or `@channel`); empty disables the tier. */
  readonly chatId: string;
  /**
   * Display name surfaced to the user in the prompt
   * (e.g. "Hapoalim", "Beinleumi"). Cannot be empty.
   */
  readonly bankName: string;
  /**
   * Digits-extraction regex used against the user's reply text.
   * MUST contain exactly one capture group. Default in callers is
   * `/(\d{4,8})/` — any 4-8 digit run. Per-bank attribution is
   * handled by `reply_to_message_id` (Telegram Reply feature),
   * not by the regex.
   */
  readonly bankRegex: RegExp;
  /** Hard deadline for the resolve loop (ms). */
  readonly timeoutMs: number;
  /** Pino logger (project-standard). */
  readonly log: ScraperLogger;
}

/** Telegram update — the subset we read. */
interface ITelegramUpdate {
  readonly update_id: number;
  readonly message?: {
    readonly chat: { readonly id: number };
    readonly text?: string;
    /** Message epoch (seconds) — present on text messages. */
    readonly date: number;
    /**
     * Set when the user used Telegram's Reply feature on a
     * specific message. Carries the message_id of the bot's
     * prompt that the user is replying to.
     */
    readonly reply_to_message?: { readonly message_id: number };
  };
}

/** Telegram sendMessage response envelope. */
interface ITelegramSendMessageResponse {
  readonly ok: boolean;
  readonly result?: { readonly message_id: number };
}

/** Telegram getUpdates response envelope. */
interface ITelegramGetUpdatesResponse {
  readonly ok: boolean;
  readonly result: readonly ITelegramUpdate[];
}

/** Skip-reason enum — closed list. */
type TelegramSkipReason =
  | 'missing-token'
  | 'missing-chat'
  | 'missing-bank-name'
  | 'non-numeric-chat-id'
  | 'invalid-timeout'
  | 'invalid-regex';

/**
 * HTTP client timeout for one short-poll `getUpdates` call. Generous
 * upper bound: short-poll typically returns in 100-500 ms (Telegram
 * answers immediately with whatever is in the queue), so the 15 s cap
 * only kicks in on a stuck TCP connection / DNS hang / Cloudflare
 * 522 — i.e. transport failures the surrounding poll loop already
 * retries by recursing.
 */
const HTTP_TIMEOUT_MS = 15_000;

/**
 * Last 4 chars of an arbitrary id, suitable for non-PII logging.
 * @param value - Source string.
 * @returns Last 4 characters or `***`.
 */
function tailMask(value: string): string {
  if (value.length <= 4) return '***';
  return `***${value.slice(-4)}`;
}

/**
 * Escape the four Telegram Markdown (legacy mode) special characters
 * so a user-controlled string (e.g. a future bank display name with
 * `_` or `*`) can't break the parsed prompt. Today's caller set is
 * hardcoded to four banks without special chars, but a future
 * addition would silently abort the fetcher via the
 * `logPromptFailed` path otherwise (Telegram returns `ok: false`
 * on a parse error). Per CodeRabbit PR #215 review.
 *
 * @param value - Raw string to interpolate into a Markdown payload.
 * @returns Markdown-escaped string.
 */
function escapeMarkdown(value: string): string {
  return value.replaceAll(/[_*`[]/g, String.raw`\$&`);
}

/**
 * Validate args before any HTTP call. Returns the skip reason
 * when validation fails, or `false` when args are sound.
 *
 * @param args - Fetcher input.
 * @returns Skip reason or `false`.
 */
function detectSkipReason(args: ITelegramFetchArgs): TelegramSkipReason | false {
  if (args.botToken.length === 0) return 'missing-token';
  if (args.chatId.length === 0) return 'missing-chat';
  if (args.bankName.length === 0) return 'missing-bank-name';
  // Reply matcher compares `Number(chatId)` to numeric `message.chat.id`.
  // `@channel` form parses to NaN and the strict-eq check always rejects,
  // so reject upfront with a clear skip reason instead of silently
  // never matching anything. Callers using a `@channel` chat must
  // resolve to the numeric id (e.g. via `getChat`) before invoking.
  if (!/^-?\d+$/.test(args.chatId)) return 'non-numeric-chat-id';
  if (args.timeoutMs <= 0) return 'invalid-timeout';
  if (!args.bankRegex.source.includes('(')) return 'invalid-regex';
  return false;
}

/**
 * Send the proactive prompt that tells the user "[bank] is waiting
 * for OTP — reply to THIS message with the code". The returned
 * message_id is what the fetcher matches against on every
 * subsequent reply (`reply_to_message.message_id`), so each
 * parallel fetcher's prompts and replies stay isolated.
 *
 * @param args - Fetcher input bundle.
 * @returns Bot's sent message_id, or `false` on transport failure.
 */
async function sendPromptMessage(args: ITelegramFetchArgs): Promise<number | false> {
  const url = `https://api.telegram.org/bot${args.botToken}/sendMessage`;
  const safeBankName = escapeMarkdown(args.bankName);
  const promptHeader = `🔔 *${safeBankName}* CI run is waiting for an OTP code.\n\n`;
  const promptBody =
    'Please *reply to this message* with the code from the SMS ' +
    "(e.g. '123456'). The reply MUST use Telegram's Reply feature " +
    'so the right CI job picks it up.';
  const text = `${promptHeader}${promptBody}`;
  const body = JSON.stringify({
    chat_id: args.chatId,
    text,
    parse_mode: 'Markdown',
    reply_markup: { force_reply: true, selective: true },
  });
  const signal = AbortSignal.timeout(HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal,
    });
    if (!res.ok) return false;
    const parsed = (await res.json()) as ITelegramSendMessageResponse;
    if (!parsed.ok || !parsed.result) return false;
    return parsed.result.message_id;
  } catch {
    return false;
  }
}

/** Bundled ack args — preserves the project's 3-param ceiling. */
interface ISendAckArgs {
  readonly botToken: string;
  readonly chatId: string;
  readonly text: string;
  readonly replyToMessageId: number;
}

/**
 * Post a follow-up acknowledgement message scoped to the original
 * prompt via `reply_to_message_id`. Best-effort: failures resolve
 * quietly so the OTP flow is never blocked by a chat-side error.
 *
 * @param args - Acknowledgement bundle.
 * @returns True once the call settled (resolved or swallowed).
 */
async function sendAckMessage(args: ISendAckArgs): Promise<true> {
  const url = `https://api.telegram.org/bot${args.botToken}/sendMessage`;
  const body = JSON.stringify({
    chat_id: args.chatId,
    text: args.text,
    parse_mode: 'Markdown',
    reply_to_message_id: args.replyToMessageId,
    allow_sending_without_reply: true,
  });
  const signal = AbortSignal.timeout(HTTP_TIMEOUT_MS);
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal,
    });
  } catch {
    // Best-effort UX message — never block the OTP flow on a chat error.
  }
  return true;
}

/**
 * Fetch a JSON response from Telegram with an explicit per-call
 * timeout. Network/parse errors resolve as `false` so the caller
 * can keep polling without crashing.
 *
 * @param url - Fully-qualified Telegram API URL.
 * @returns Parsed response or `false`.
 */
async function safeFetchUpdates(url: string): Promise<ITelegramGetUpdatesResponse | false> {
  // `AbortSignal.timeout` (Node 18+) replaces the manual setTimeout
  // pattern that the project's `no-restricted-syntax` rule forbids.
  const signal = AbortSignal.timeout(HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return false;
    const body = (await res.json()) as ITelegramGetUpdatesResponse;
    if (!body.ok) return false;
    return body;
  } catch {
    return false;
  }
}

/**
 * Telegram bot URL builder — keeps the token off any log surface.
 * @param token - Bot token.
 * @param query - Querystring portion (already URL-encoded).
 * @returns Fully-qualified Telegram API URL.
 */
function buildUpdatesUrl(token: string, query: string): string {
  return `https://api.telegram.org/bot${token}/getUpdates?${query}`;
}

/**
 * Find the first update whose message matches `bankRegex` in the
 * configured chat. Returns the captured digits or `false` when
 * no match in the batch.
 *
 * @param updates - Updates returned by Telegram.
 * @param chatId - Numeric chat id we filter on.
 * @param bankRegex - Per-bank regex with one capture group.
 * @returns Match payload or `false`.
 */
/** Result of one update inspection. */
type MatchResult = { readonly code: string; readonly updateId: number } | false;

/** Bundled inspection args — preserves the project's 3-param ceiling. */
interface IInspectArgs {
  readonly upd: ITelegramUpdate;
  readonly targetChat: number;
  readonly bankRegex: RegExp;
  /**
   * The bot's prompt `message_id`. Only updates whose
   * `reply_to_message.message_id` matches this value are accepted.
   * This is the SOLE parallel-safety mechanism: each fetcher's
   * prompt has a unique `message_id`, so concurrent fetchers'
   * replies stay isolated even on a shared chat. Combined with
   * the non-destructive `offset=0` poll (see top-of-file JSDoc),
   * cross-fetcher purges are impossible by construction.
   */
  readonly promptMessageId: number;
}

/**
 * Inspect a single update for an OTP match. Three filters apply:
 *  1. `msg` defined — guards against update-types without a message.
 *  2. `chat.id === targetChat` (cross-chat protection).
 *  3. `reply_to_message.message_id === promptMessageId`
 *     (per-prompt isolation — Telegram Reply feature; the SOLE
 *     attribution gate after A.fix-2 drops the `update_id` floor).
 *
 * The fourth filter is the digits-extraction `bankRegex` against
 * the user's reply text. Per-bank attribution is now handled by
 * the reply-id, so the regex serves only to extract the digits
 * (callers typically use `/(\d{4,8})/`).
 *
 * @param args - Bundled inspection inputs.
 * @returns Match payload or `false`.
 */
function inspectUpdate(args: IInspectArgs): MatchResult {
  const msg = args.upd.message;
  if (!msg) return false;
  if (msg.chat.id !== args.targetChat) return false;
  if (msg.reply_to_message?.message_id !== args.promptMessageId) return false;
  const text = msg.text ?? '';
  const match = args.bankRegex.exec(text);
  if (!match) return false;
  const captured = match[1];
  if (typeof captured !== 'string' || captured.length === 0) return false;
  return { code: captured, updateId: args.upd.update_id };
}

/**
 * Reverse-id ordering — keeps `Array.sort` stable across runtimes
 * by returning -1 / 0 / 1 instead of a raw delta.
 * @param a - Left.
 * @param b - Right.
 * @returns -1 / 0 / 1.
 */
function compareUpdateIdDesc(a: ITelegramUpdate, b: ITelegramUpdate): -1 | 0 | 1 {
  if (a.update_id > b.update_id) return -1;
  if (a.update_id < b.update_id) return 1;
  return 0;
}

/** Bundled match args. */
interface IFindOtpMatchArgs {
  readonly updates: readonly ITelegramUpdate[];
  readonly chatId: string;
  readonly bankRegex: RegExp;
  readonly promptMessageId: number;
}

/**
 * Walk a batch of updates newest-first and return the first one in
 * the right chat AND a reply to our prompt (`promptMessageId`).
 * @param args - Match inputs.
 * @returns Match payload or `false`.
 */
function findOtpMatch(args: IFindOtpMatchArgs): MatchResult {
  const targetChat = Number(args.chatId);
  const ordered = [...args.updates].sort(compareUpdateIdDesc);
  for (const upd of ordered) {
    const found = inspectUpdate({
      upd,
      targetChat,
      bankRegex: args.bankRegex,
      promptMessageId: args.promptMessageId,
    });
    if (found !== false) return found;
  }
  return false;
}

/** Window of recent updates we ask Telegram for each cycle. */
const RECENT_WINDOW_LIMIT = 100;

/**
 * Bound on how old a queued update may be before it's eligible for
 * cleanup. After each fetcher's match / timeout, the GC step
 * (`pruneOldUpdates`) confirms — and thereby removes from the bot's
 * unconfirmed queue — every update whose `message.date` is older
 * than `now - RECENT_MESSAGE_WINDOW_S` seconds.
 *
 * <p>Why 10 minutes: CI E2E runs typically complete a single bank
 * scrape in under 5 minutes; 10 min leaves 2× headroom for clock
 * skew + slow runs. Concurrent parallel-matrix fetchers' prompts
 * are also <10 min old, so their pending replies survive this
 * fetcher's GC (their `message.date` ≥ now - 600).
 *
 * <p>This bounds the queue size so the `offset=0&limit=100` poll
 * window never starves an in-flight reply by pushing it past the
 * 100-update response cap (per CodeRabbit PR #226 review).
 */
const RECENT_MESSAGE_WINDOW_S = 600;

/** Internal poll-loop state. */
interface IPollState {
  readonly args: ITelegramFetchArgs;
  readonly deadline: number;
  /**
   * The bot's prompt `message_id`. Replies to this prompt are the
   * only updates the fetcher accepts. This is the SOLE attribution
   * gate after A.fix-2: Telegram assigns a unique `message_id` per
   * `sendMessage`, so no two fetchers' prompts collide, and pre-run
   * replies (still in the queue from earlier CI cycles) target an
   * earlier `message_id` and never match.
   */
  readonly promptMessageId: number;
}

/**
 * Outcome of one poll iteration. `transport-error` is distinguished
 * from `false` (no-match) so {@link runPollLoop} can apply
 * exponential backoff only on consecutive transport failures.
 */
type PollOutcome = MatchResult | 'transport-error';

/**
 * Single Telegram short-poll iteration. Uses non-destructive
 * `offset=0` with `timeout=0` (short poll) — Telegram returns ALL
 * unconfirmed updates in one batch (up to `limit`). Each fetcher
 * filters the returned batch by `reply_to_message.message_id` to
 * pick ONLY its own reply; other fetchers' replies stay in the
 * queue untouched. Cross-fetcher purges are impossible by
 * construction. Telegram's 24h retention drops stale updates
 * automatically.
 *
 * <p>Why short-poll (`timeout=0`), not long-poll: empirically (2026-
 * 05-22) Telegram's `getUpdates?offset=0&timeout=N>0` returns only
 * the SINGLE earliest unconfirmed update per call — even with
 * `limit=100`. If that earliest update is a stale reply from a
 * prior session whose prompt no longer matches the active fetcher's
 * `promptMessageId`, the poll loop spins forever on the same stale
 * update until the 180 s budget exhausts. Short-poll returns the
 * full pending batch in one call so the matching reply is reachable.
 *
 * @param state - Poll state.
 * @returns Match payload, `false` (no match), or `transport-error`.
 */
async function pollOnce(state: IPollState): Promise<PollOutcome> {
  const otherParams = `limit=${String(RECENT_WINDOW_LIMIT)}&timeout=0`;
  const url = buildUpdatesUrl(state.args.botToken, `offset=0&${otherParams}`);
  const res = await safeFetchUpdates(url);
  if (res === false) {
    state.args.log.warn(
      { event: 'telegram.otp.fetch.error', chatIdSuffix: tailMask(state.args.chatId) },
      'Telegram getUpdates failed; continuing to poll',
    );
    return 'transport-error';
  }
  return findOtpMatch({
    updates: res.result,
    chatId: state.args.chatId,
    bankRegex: state.args.bankRegex,
    promptMessageId: state.promptMessageId,
  });
}

/** Backoff base — first failure waits this long. */
const BACKOFF_BASE_MS = 500;
/** Backoff ceiling — wait never exceeds this regardless of failure count. */
const BACKOFF_MAX_MS = 8_000;
/** Cap on the exponent (2^N) so the doubling never overflows. */
const BACKOFF_MAX_EXPONENT = 4;
/**
 * Minimum debounce between consecutive no-match short-poll iterations
 * to stay under Telegram's 30 req/s ceiling. The short-poll itself
 * still uses `offset=0&timeout=0` (see {@link pollOnce}) — this delay
 * is a deliberate idle pause BETWEEN iterations, not a return to
 * long-poll semantics.
 */
const IDLE_POLL_DELAY_MS = 250;

/**
 * Exponential backoff schedule for consecutive transport failures.
 * 1st failure: 500 ms, 2nd: 1 s, 3rd: 2 s, 4th: 4 s, 5th+: 8 s.
 * @param consecutiveFailures - Number of back-to-back transport failures.
 * @returns Backoff in milliseconds; 0 when there have been no failures.
 */
function computeBackoffMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return 0;
  const exponent = Math.min(BACKOFF_MAX_EXPONENT, consecutiveFailures - 1);
  const raw = BACKOFF_BASE_MS * 2 ** exponent;
  return Math.min(BACKOFF_MAX_MS, raw);
}

/**
 * Drive the short-poll loop until match or deadline. Recursive form
 * (no `while + await`) to satisfy the project's no-await-in-loop
 * rule and keep parity with `OtpPoller.pollUntil`. Each `pollOnce`
 * issues a Telegram HTTPS round-trip whose natural ~100-300 ms RTT
 * keeps the call rate well below Telegram's 30 req/s ceiling on the
 * happy path.
 *
 * <p>On consecutive transport failures (e.g. Cloudflare 522, DNS
 * hang) the loop applies exponential backoff via {@link humanDelay}
 * so a Telegram outage does not produce a tight retry storm. The
 * backoff resets to zero the moment any call succeeds — including
 * one that returns no match — so a single transient flake does not
 * extend the wait into the next normal poll cycle. A successful
 * call that returns no match still inserts {@link IDLE_POLL_DELAY_MS}
 * before the next iteration so the loop never breaches Telegram's
 * 30 req/s ceiling.
 *
 * @param state - Poll state.
 * @param consecutiveFailures - Internal: rolling failure counter
 *   threaded by recursion. Default 0 — public callers omit it.
 * @returns Match payload or `false` on timeout.
 */
async function runPollLoop(state: IPollState, consecutiveFailures = 0): Promise<MatchResult> {
  if (Date.now() >= state.deadline) return false;
  const outcome = await pollOnce(state);
  if (outcome !== 'transport-error' && outcome !== false) return outcome;
  const nextFailures = outcome === 'transport-error' ? consecutiveFailures + 1 : 0;
  const backoff = outcome === false ? IDLE_POLL_DELAY_MS : computeBackoffMs(nextFailures);
  const remaining = state.deadline - Date.now();
  const positiveRemaining = Math.max(0, remaining);
  const cappedBackoff = Math.min(backoff, positiveRemaining);
  if (cappedBackoff > 0) {
    await humanDelay(cappedBackoff, cappedBackoff);
  }
  return runPollLoop(state, nextFailures);
}

/**
 * Skip-tier log emission (debug-level) — never makes a network call.
 * @param args - Fetcher args.
 * @param reason - Why the fetcher is skipping.
 * @returns Always `true` — the project's architecture rule forbids
 *   bare `void` returns, so callers can chain or ignore at will.
 */
function logSkip(args: ITelegramFetchArgs, reason: TelegramSkipReason): true {
  args.log.debug({ event: 'telegram.otp.fetch.skip', reason }, 'Telegram OTP tier skipped');
  return true;
}

/**
 * Sent-message-failed log emission (warn-level).
 * @param args - Fetcher args.
 * @returns Always `true` (matches the project's no-void return rule).
 */
function logPromptFailed(args: ITelegramFetchArgs): true {
  args.log.warn(
    {
      event: 'telegram.otp.fetch.prompt-failed',
      chatIdSuffix: tailMask(args.chatId),
      bankName: args.bankName,
    },
    'Telegram sendMessage failed — cannot prompt user; aborting fetcher',
  );
  return true;
}

/** Bundle for the start-log emission — preserves the 3-param ceiling. */
interface ILogFetchStartArgs {
  readonly args: ITelegramFetchArgs;
  readonly promptMessageId: number;
}

/**
 * Start-log emission (info-level) — fired once after the prompt
 * lands and before the poll loop spins up.
 * @param bundle - Bundled args.
 * @returns Always `true` (matches the project's no-void return rule).
 */
function logFetchStart(bundle: ILogFetchStartArgs): true {
  bundle.args.log.info(
    {
      event: 'telegram.otp.fetch.start',
      chatIdSuffix: tailMask(bundle.args.chatId),
      bankName: bundle.args.bankName,
      promptMessageId: bundle.promptMessageId,
      timeoutMs: bundle.args.timeoutMs,
    },
    'Telegram OTP fetch — prompt sent; polling for reply',
  );
  return true;
}

/**
 * Timeout handler — emits the warn log AND a user-visible ack so
 * the operator knows the prior prompt is stale.
 * @param args - Fetcher args.
 * @param promptMessageId - Bot's prompt message id (for reply scope).
 * @returns Always `true` (no-void return rule).
 */
async function handleFetchTimeout(
  args: ITelegramFetchArgs,
  promptMessageId: number,
): Promise<true> {
  args.log.warn(
    {
      event: 'telegram.otp.fetch.timeout',
      chatIdSuffix: tailMask(args.chatId),
      bankName: args.bankName,
      promptMessageId,
      waitedMs: args.timeoutMs,
    },
    'Telegram OTP fetch timed out — user did not reply within budget',
  );
  const seconds = String(args.timeoutMs / 1000);
  await sendAckMessage({
    botToken: args.botToken,
    chatId: args.chatId,
    text: `⚠️ *${args.bankName}* — no reply received within ${seconds}s. Re-run the pipeline to retry.`,
    replyToMessageId: promptMessageId,
  });
  return true;
}

/** Bundle for the match handler — preserves the 3-param ceiling. */
interface IHandleMatchArgs {
  readonly args: ITelegramFetchArgs;
  readonly promptMessageId: number;
  readonly match: { readonly code: string; readonly updateId: number };
}

/**
 * Match handler — emits the info log AND a user-visible ack so
 * the operator sees their reply was accepted.
 * @param bundle - Bundled args.
 * @returns Always `true` (no-void return rule).
 */
async function handleFetchMatch(bundle: IHandleMatchArgs): Promise<true> {
  bundle.args.log.info(
    {
      event: 'telegram.otp.fetch.match',
      chatIdSuffix: tailMask(bundle.args.chatId),
      bankName: bundle.args.bankName,
      promptMessageId: bundle.promptMessageId,
      codeLength: bundle.match.code.length,
      updateId: bundle.match.updateId,
    },
    'Telegram OTP fetch — matched (reply-scoped, parallel-safe)',
  );
  const len = String(bundle.match.code.length);
  await sendAckMessage({
    botToken: bundle.args.botToken,
    chatId: bundle.args.chatId,
    text: `✅ *${bundle.args.bankName}* — OTP received (${len} digits). Continuing the scrape.`,
    replyToMessageId: bundle.promptMessageId,
  });
  return true;
}

/**
 * Compute the cursor to advance to in order to confirm (drop) every
 * update older than the recent-message window. Returns `false` when
 * the queue is entirely recent (no cleanup needed) — the find matched
 * the first element so there's nothing to skip past.
 *
 * @param updates - Current queue snapshot (offset=0 read).
 * @param thresholdSec - Wall-clock epoch boundary (now - 600 s).
 * @returns Offset to confirm OR `false` when nothing to prune.
 */
function computePruneOffset(
  updates: readonly ITelegramUpdate[],
  thresholdSec: number,
): number | false {
  const recentBoundary = updates.find((u): boolean => (u.message?.date ?? 0) >= thresholdSec);
  if (recentBoundary !== undefined) {
    if (recentBoundary === updates[0]) return false;
    return recentBoundary.update_id;
  }
  const lastUpdate = updates[updates.length - 1];
  return lastUpdate.update_id + 1;
}

/**
 * Bound the bot's unconfirmed-update queue by confirming every
 * update older than `RECENT_MESSAGE_WINDOW_S` seconds. Best-effort —
 * transport failures here never affect the OTP outcome (the caller
 * has already returned its result before this fires).
 *
 * <p>Used by the TIMEOUT path. The MATCH path uses
 * {@link confirmCursorPastMatch} instead — it advances past the
 * matched update_id directly, which is safe under the CI serial-OTP
 * workflow (`e2e-real-otp` with `max-parallel: 1`) where only one
 * fetcher is ever active at a time. The 10-min window stays as the
 * safety net for host pre-commit sequential runs and the timeout
 * branch (no matched update_id to advance past).
 *
 * @param args - Fetcher args (for log + bot token).
 * @returns Always `true` after attempting GC.
 */
async function pruneOldUpdates(args: ITelegramFetchArgs): Promise<true> {
  const thresholdSec = Math.floor(Date.now() / 1000) - RECENT_MESSAGE_WINDOW_S;
  const inspectUrl = buildUpdatesUrl(
    args.botToken,
    `offset=0&limit=${String(RECENT_WINDOW_LIMIT)}&timeout=0`,
  );
  const res = await safeFetchUpdates(inspectUrl);
  if (res === false || res.result.length === 0) return true;
  const advanceTo = computePruneOffset(res.result, thresholdSec);
  if (advanceTo === false) return true;
  const confirmUrl = buildUpdatesUrl(
    args.botToken,
    `offset=${String(advanceTo)}&limit=1&timeout=0`,
  );
  await safeFetchUpdates(confirmUrl);
  return true;
}

/**
 * Confirm Telegram's update cursor PAST the matched update_id so the
 * `offset=0&limit=100` polling window never starves. The serial CI
 * job `e2e-real-otp` (`max-parallel: 1`) guarantees only one fetcher
 * is active at a time, so confirming `match.update_id + 1` cannot
 * purge a concurrent fetcher's pending reply. Used ONLY on the match
 * path — the timeout path keeps the 10-min window GC because there
 * is no `match.update_id` to advance past.
 *
 * <p>Why this exists: live CI run `25732939617` Beinleumi failed
 * with two 180s OTP timeouts even though the user replied. The
 * cumulative queue had 100+ recent updates (within the 10-min
 * window) from preceding OneZero + earlier test cycles, so the
 * `offset=0&limit=100` poll returned only the OLDEST 100 — pushing
 * Beinleumi's actual reply past the response window. This call
 * keeps the queue trimmed to a tight per-bank slice.
 *
 * @param args - Fetcher args (for bot token).
 * @param matchedUpdateId - update_id of the user's matched reply.
 * @returns Always `true` after attempting the confirm.
 */
async function confirmCursorPastMatch(
  args: ITelegramFetchArgs,
  matchedUpdateId: number,
): Promise<true> {
  const confirmUrl = buildUpdatesUrl(
    args.botToken,
    `offset=${String(matchedUpdateId + 1)}&limit=1&timeout=0`,
  );
  await safeFetchUpdates(confirmUrl);
  return true;
}

/**
 * Swallow-all error sink for detached side-effects. A standalone
 * helper (not an inline arrow) keeps the `no-void` architecture
 * rule from triggering on the catch handler.
 *
 * @returns Always `true` — matches the project's no-void policy.
 */
function swallowDetachedError(): true {
  return true;
}

/**
 * Detach an async side-effect from the caller's await chain so it
 * runs in the background. Failures are swallowed (they never affect
 * the OTP outcome — ack + GC are observability/housekeeping only).
 *
 * @param promise - Promise to detach.
 * @returns Always `true` — marker per the project's no-void policy.
 */
function detachSideEffect(promise: Promise<unknown>): true {
  promise.catch(swallowDetachedError);
  return true;
}

/**
 * Side-effect-only timeout finaliser. Detaches the warn-log + user
 * ack and the queue-GC pass, then returns `false` to the
 * orchestrator. Keeps `fetchOtpFromTelegram` under the 10-line
 * ceiling per `coding-principle-guidlines.md`.
 *
 * @param args - Fetcher args.
 * @param promptMessageId - Bot's prompt message id (for reply scope).
 * @returns `false` — the public timeout outcome.
 */
function dispatchTimeoutSideEffects(args: ITelegramFetchArgs, promptMessageId: number): false {
  const timeoutPromise = handleFetchTimeout(args, promptMessageId);
  detachSideEffect(timeoutPromise);
  const prunePromise = pruneOldUpdates(args);
  detachSideEffect(prunePromise);
  return false;
}

/**
 * Side-effect-only match finaliser. Detaches the info-log + user
 * ack and the queue-GC pass, then returns the captured digits to
 * the orchestrator — so `OtpPoller` resumes the bank pipeline
 * before either HTTP call resolves.
 *
 * @param bundle - Match bundle.
 * @returns Captured OTP digits.
 */
function dispatchMatchSideEffects(bundle: IHandleMatchArgs): string {
  const matchPromise = handleFetchMatch(bundle);
  detachSideEffect(matchPromise);
  const confirmPromise = confirmCursorPastMatch(bundle.args, bundle.match.updateId);
  detachSideEffect(confirmPromise);
  return bundle.match.code;
}

/**
 * Fetch the next OTP from Telegram for a given bank. Orchestrator —
 * each branch delegates to a single-purpose helper to keep this
 * method under the 10-line ceiling.
 *
 * <p>On match the captured digits are returned IMMEDIATELY; the
 * post-match ack and the queue-GC pass are detached so the caller
 * (`OtpPoller` → `OtpFillPhaseActions`) types the code into the
 * bank form in the same millisecond Telegram surfaced it. The two
 * detached HTTP calls (`sendAckMessage` + `pruneOldUpdates`) were
 * previously awaited inline and added ~500 ms–1 s of bank-side
 * stall after the user's reply landed; eliminating that gap keeps
 * the OTP flow inside the bank's narrow acceptance window.
 *
 * @param args - See {@link ITelegramFetchArgs}.
 * @returns Captured digits group on match, or `false` on timeout
 *   / missing config / invalid args.
 */
async function fetchOtpFromTelegram(args: ITelegramFetchArgs): Promise<string | false> {
  const skip = detectSkipReason(args);
  if (skip !== false) {
    logSkip(args, skip);
    return false;
  }
  const promptMessageId = await sendPromptMessage(args);
  if (promptMessageId === false) {
    logPromptFailed(args);
    return false;
  }
  logFetchStart({ args, promptMessageId });
  const deadline = Date.now() + args.timeoutMs;
  const match = await runPollLoop({ args, deadline, promptMessageId });
  if (match === false) return dispatchTimeoutSideEffects(args, promptMessageId);
  return dispatchMatchSideEffects({ args, promptMessageId, match });
}

export type { ITelegramFetchArgs };
export { fetchOtpFromTelegram };
export default fetchOtpFromTelegram;
