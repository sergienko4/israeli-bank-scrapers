import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { writeTextFile } from './shared.mjs';

/**
 * Collect text parts from an OpenCode JSONL stream.
 * @param {string} text - JSONL output.
 * @returns {string} Joined text parts.
 */
export function extractText(text) {
  const parts = [];
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === 'text' && typeof event.part?.text === 'string') {
        parts.push(event.part.text);
      }
    } catch {
      // Ignore a partial or non-JSON line; the final JSON is still checked.
    }
  }
  return parts.join('').trim();
}

/**
 * CLI entrypoint.
 * @returns {Promise<void>} Resolves when the review text is written.
 */
async function main() {
  const input = process.env.AGENT_STREAM || '.review/pr/agent.jsonl';
  const output = process.env.AGENT_RESULT || '.review/pr/result.json';
  const text = extractText(await readFile(input, 'utf8'));
  await writeTextFile(output, `${text}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`pr-review extract failed: ${error.name}`);
    process.exitCode = 1;
  });
}
