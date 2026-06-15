/**
 * Generic scrape executor — barrel facade.
 *
 * Banks provide config (URLs, mappers); this module's sub-tree handles
 * fetch, per-account iteration, and assembly. The implementation was
 * split behind this facade during the Phase 12e file-size drain so each
 * concern stays under the `max-lines:150` cap:
 *
 *   • {@link ./Executor/Types.js}   — shared brands + bundled-arg shapes.
 *   • {@link ./Executor/Fetch.js}   — transport + request helpers.
 *   • {@link ./Executor/Account.js} — per-account assembly + iteration.
 *   • {@link ./Executor/Execute.js} — `executeScrape` orchestrator.
 *
 * The public surface (`executeScrape`, default + named) is unchanged so
 * consumers (`ScrapeStepFactory`, the executor unit tests) keep their
 * existing imports.
 */

export { default, executeScrape } from './Executor/Execute.js';
