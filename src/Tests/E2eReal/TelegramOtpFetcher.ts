/**
 * Telegram-side OTP delivery for CI E2E Real jobs.
 *
 * <p>The fetcher polls the Telegram Bot API's `getUpdates` endpoint
 * with a positive offset (`offset=minUpdateId+1`), filters by
 * `reply_to_message.message_id === promptMessageId` + chat id +
 * per-bank regex, and resolves with the captured digits. Positive
 * offset is REQUIRED so Telegram's long-poll short-circuits on
 * NEW data — with a negative offset (`offset=-N`) Telegram returns
 * the static last-N snapshot and never wakes early, so a reply that
 * lands mid-cycle stays unseen until the next polling tick (CI run
 * `25690651046` Beinleumi: user replied 12s after prompt; the
 * `offset=-100`/`timeout=1` poll never returned that reply within
 * the 180s budget). See CodeRabbit thread on commit `7b9a1a69`.
 *
 * <p>Per-prompt isolation is preserved via the `reply_to_message`
 * filter, not via the offset. Each fetcher sends its own prompt
 * with a unique `message_id`; only replies pointing at THAT id
 * qualify. With this isolation guarantee in place, advancing the
 * bot's confirmed cursor (an unavoidable side effect of positive
 * offsets) is safe for our test workload.
 *
 * <p>Known limitation — `readInitialUpdateId` still uses
 * `offset=-1` which "forgets all previous" (Telegram Bot API
 * semantics). In a multi-fetcher matrix this MAY purge another
 * fetcher's pending reply if both fetchers' `readInitialUpdateId`
 * fire while the other's reply is queued. Tracked as a Phase
 * A.fix-2 follow-up: replace the probe with a queue-introspection
 * call that doesn't advance the cursor (or move to a shared poll
 * proxy / per-bank bots). For OTP volumes observed in practice
 * (1-2 messages per fetcher-minute) the risk is small enough to
 * accept here.
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
 * Per-cycle long-poll budget (seconds). Capped well below Telegram's
 * 50 s ceiling. With positive-offset polling Telegram early-returns
 * on new data, so the cycle wall is the worst-case detection latency
 * when no new updates arrive. 10 s keeps polling pressure at ~6 RPS
 * over the 180 s budget — within rate ceilings — and gives the user
 * a sub-second ack as soon as the reply lands (the call wakes
 * immediately on new updates).
 */
const TELEGRAM_LONG_POLL_S = 10;
/** HTTP client timeout — Telegram's long-poll + 5 s headroom. */
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
  /** Update_id floor — only updates with `update_id > this` qualify. */
  readonly minUpdateId: number;
  /**
   * The bot's prompt `message_id`. Only updates whose
   * `reply_to_message.message_id` matches this value are accepted.
   * This is the parallel-safety mechanism: each fetcher's prompt
   * has a unique `message_id`, so concurrent fetchers' replies
   * stay isolated even on a shared chat.
   */
  readonly promptMessageId: number;
}

/**
 * Inspect a single update for an OTP match. Three filters apply:
 *  1. `update_id > minUpdateId` (per-fetcher floor)
 *  2. `chat.id === targetChat` (cross-chat protection)
 *  3. `reply_to_message.message_id === promptMessageId`
 *     (per-prompt isolation — Telegram Reply feature)
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
  if (args.upd.update_id <= args.minUpdateId) return false;
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
  readonly minUpdateId: number;
  readonly promptMessageId: number;
}

/**
 * Walk a batch of updates newest-first and return the first one
 * that's strictly newer than `minUpdateId`, in the right chat,
 * AND a reply to our prompt (`promptMessageId`).
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
      minUpdateId: args.minUpdateId,
      promptMessageId: args.promptMessageId,
    });
    if (found !== false) return found;
  }
  return false;
}

/** Window of recent updates we ask Telegram for each cycle. */
const RECENT_WINDOW_LIMIT = 100;

/**
 * Capture the highest `update_id` currently visible on the bot,
 * read-only (`offset=-1` returns the last update without confirming
 * anything). Subsequent polls accept ONLY updates strictly greater
 * than this value — the per-fetcher floor that prevents picking up
 * stale OTPs that the chat already had.
 *
 * @param token - Bot token.
 * @returns Highest seen update_id, or 0 when chat empty.
 */
async function readInitialUpdateId(token: string): Promise<number> {
  const url = buildUpdatesUrl(token, 'offset=-1&limit=1&timeout=0');
  const res = await safeFetchUpdates(url);
  if (res === false || res.result.length === 0) return 0;
  return res.result[0].update_id;
}

/** Internal poll-loop state. */
interface IPollState {
  readonly args: ITelegramFetchArgs;
  readonly deadline: number;
  /**
   * `update_id` floor captured at fetcher start. Strict-greater-than
   * filter on every poll cycle — guarantees this fetcher never picks
   * up an OTP that arrived in the chat BEFORE this run started, and
   * never collides with a parallel fetcher's match (each parallel
   * fetcher has its own `minUpdateId` based on when IT started).
   */
  readonly minUpdateId: number;
  /**
   * The bot's prompt `message_id`. Replies to this prompt are the
   * only updates the fetcher accepts.
   */
  readonly promptMessageId: number;
}

/**
 * Compute a long-poll budget bounded by the remaining deadline.
 * @param deadline - Wall-clock deadline ms.
 * @returns Long-poll seconds in [1, TELEGRAM_LONG_POLL_S].
 */
function computeLongPollSeconds(deadline: number): number {
  const remaining = deadline - Date.now();
  const remainingSec = Math.floor(remaining / 1000);
  const flooredAtOne = Math.max(1, remainingSec);
  return Math.min(TELEGRAM_LONG_POLL_S, flooredAtOne);
}

/**
 * Single Telegram long-poll iteration. Uses positive offset
 * (`offset=minUpdateId+1`) so Telegram short-circuits the long-poll
 * as soon as a new update arrives — the design property that fixes
 * the Beinleumi CI miss (CI run `25690651046`, where `offset=-N`
 * with a 1 s cycle never returned the user's reply that arrived 12 s
 * after the prompt). The offset stays stable across cycles (we do
 * NOT advance it past `minUpdateId+1`) so this fetcher's own floor
 * remains the only side effect on the bot's confirmed cursor.
 *
 * @param state - Poll state.
 * @returns Match payload or `false`.
 */
async function pollOnce(state: IPollState): Promise<MatchResult> {
  const longPoll = computeLongPollSeconds(state.deadline);
  const offsetParam = `offset=${String(state.minUpdateId + 1)}`;
  const otherParams = `limit=${String(RECENT_WINDOW_LIMIT)}&timeout=${String(longPoll)}`;
  const url = buildUpdatesUrl(state.args.botToken, `${offsetParam}&${otherParams}`);
  const res = await safeFetchUpdates(url);
  if (res === false) {
    state.args.log.warn(
      { event: 'telegram.otp.fetch.error', chatIdSuffix: tailMask(state.args.chatId) },
      'Telegram getUpdates failed; continuing to poll',
    );
    return false;
  }
  return findOtpMatch({
    updates: res.result,
    chatId: state.args.chatId,
    bankRegex: state.args.bankRegex,
    minUpdateId: state.minUpdateId,
    promptMessageId: state.promptMessageId,
  });
}

/**
 * Drive the long-poll loop until match or deadline. Recursive form
 * (no `while + await`) to satisfy the project's no-await-in-loop
 * rule and keep parity with `OtpPoller.pollUntil`.
 *
 * @param state - Poll state.
 * @returns Match payload or `false` on timeout.
 */
async function runPollLoop(state: IPollState): Promise<MatchResult> {
  if (Date.now() >= state.deadline) return false;
  const match = await pollOnce(state);
  if (match !== false) return match;
  return runPollLoop(state);
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
  readonly minUpdateId: number;
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
      minUpdateId: bundle.minUpdateId,
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
 * Fetch the next OTP from Telegram for a given bank. Orchestrator —
 * each branch delegates to a single-purpose helper to keep this
 * method under the 10-line ceiling.
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
  const minUpdateId = await readInitialUpdateId(args.botToken);
  const promptMessageId = await sendPromptMessage(args);
  if (promptMessageId === false) {
    logPromptFailed(args);
    return false;
  }
  logFetchStart({ args, promptMessageId, minUpdateId });
  const deadline = Date.now() + args.timeoutMs;
  const match = await runPollLoop({ args, deadline, minUpdateId, promptMessageId });
  if (match === false) {
    await handleFetchTimeout(args, promptMessageId);
    return false;
  }
  await handleFetchMatch({ args, promptMessageId, match });
  return match.code;
}

export type { ITelegramFetchArgs };
export { fetchOtpFromTelegram };
export default fetchOtpFromTelegram;
