import * as fs from 'fs';

/**
 * ARCHITECTURE GATEWAY - MODULE LEVEL
 * Rule #14: UPPER_CASE for module-level constants only.
 * Block-scoped variables (inside for/if) use camelCase per ESLint naming-convention.
 */
const LOG_FILE = '.architecture-violations.log';
const PIPELINE_DIR = 'Scrapers/Pipeline';
const PHASE_DIR = 'Phases';

const STAGED_FILES = process.argv.slice(2);
const REPORTS: { file: string; violations: string[] }[] = [];

for (const filePath of STAGED_FILES) {
  if (!fs.existsSync(filePath) || fs.lstatSync(filePath).isDirectory()) continue;

  const code = fs.readFileSync(filePath, 'utf8');
  const issues: string[] = [];

  // Rule 15: Primitives
  if (filePath.includes(PIPELINE_DIR) || filePath.includes(PHASE_DIR)) {
    const primitives = code.match(/:\s(?:boolean|string|number|void)(?=\s*[{;=]|\s*\n)/g) ?? [];
    for (const match of primitives) {
      issues.push(`[Rule #15] Forbidden primitive: ${match.trim()}`);
    }
  }

  // Rule 10: Playwright Leak
  if (filePath.includes(PHASE_DIR) && /from ['"]playwright['"]/.test(code)) {
    issues.push('[Rule #10] Playwright leaked into Phase.');
  }

  // Async Safety: skip function declarations (function fetchX / function executeX)
  // Only flags actual CALLS that aren't awaited, ignoring definitions
  const dangling =
    code.match(
      /(?<!await\s+)(?<!async\s+)(?<!function\s+)(?<!const\s+)(?<!export\s+)(?:execute|fetch|run|step)\w+\(/g,
    ) ?? [];
  for (const call of dangling) {
    issues.push(`[Async] Unawaited: ${call.replace('(', '')}`);
  }

  if (issues.length > 0) {
    REPORTS.push({ file: filePath, violations: issues });
  }
}

if (REPORTS.length > 0) {
  const logContent = JSON.stringify(REPORTS, null, 2);
  fs.writeFileSync(LOG_FILE, logContent);
  const totalViolations = REPORTS.reduce((acc, r) => acc + r.violations.length, 0);
  process.stderr.write(`❌ Architecture Check: ${totalViolations.toString()} violations.\n`);
  process.exit(1);
}

process.exit(0);
