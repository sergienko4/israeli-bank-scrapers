/**
 * Jest-free memory harness: launches the browser exactly the way the
 * published scraper does, opens one page, and holds it at steady state
 * long enough for the sampler to capture the peak.
 *
 * This isolates the footprint a *consumer* of the package actually pays
 * (Node runtime + Camoufox process tree) from the Jest/ts-jest harness
 * overhead, which dwarfs it and is irrelevant outside our test suite.
 *
 * Run under the profiler:
 *   node scripts/memory-profile/profile-bank.mjs browser --mode=standalone
 */
import { launchCamoufox } from '../../src/Scrapers/Pipeline/Mediator/Browser/CamoufoxLauncher.js';

const HOLD_MS = 15_000;
const MB = 1024 * 1024;

/**
 * Report the current Node-side heap and RSS for context. The sampler
 * measures the whole OS process tree; this line only helps attribute
 * how much of the Node share is JavaScript heap.
 * @param label - Stage name to print alongside the numbers.
 */
function logNodeMemory(label: string): void {
  const m = process.memoryUsage();
  const rss = (m.rss / MB).toFixed(0);
  const heap = (m.heapUsed / MB).toFixed(0);
  process.stdout.write(`[standalone] ${label}: node rss=${rss}MB heapUsed=${heap}MB\n`);
}

async function main(): Promise<void> {
  logNodeMemory('before launch');
  const browser = await launchCamoufox(true);
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  await page.goto('about:blank');
  logNodeMemory('browser up');
  await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
  logNodeMemory('steady state');
  await context.close();
  await browser.close();
}

main().catch((error: unknown) => {
  process.stderr.write(`standalone harness failed: ${String(error)}\n`);
  process.exit(1);
});
