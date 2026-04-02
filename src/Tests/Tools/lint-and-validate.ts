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

  // Async Safety: find all execute/fetch/run/step calls, exclude awaited + declarations
  const callPattern = /^.*(?:execute|fetch|run|step)\w+\(/gm;
  const safePattern =
    /await\s|async\s|function\s|const\s|export\s|return\s|import\s|describe\(|it\(|['"`]/;
  const namePattern = /(?:execute|fetch|run|step)\w+/;
  let callMatch = callPattern.exec(code);
  while (callMatch) {
    const line = callMatch[0];
    if (!safePattern.test(line)) {
      const nameMatch = namePattern.exec(line);
      if (nameMatch) issues.push(`[Async] Unawaited: ${nameMatch[0]}`);
    }
    callMatch = callPattern.exec(code);
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
