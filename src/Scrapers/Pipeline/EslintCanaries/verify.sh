#!/usr/bin/env bash
# ESLint Canary Verification — asserts every canary file triggers at least 1 error.
# If any canary has 0 errors, the corresponding ESLint rule is dead.
set -euo pipefail

CANARY_DIR="$(cd "$(dirname "$0")" && pwd)"

# ESLint returns non-zero on lint errors — that's expected for canaries.
# Capture JSON output, allow non-zero exit.
ERRORS=$(npx eslint "$CANARY_DIR"/*.canary.ts --no-ignore --format json 2>/dev/null) || true

# Pass JSON as argv[1] to avoid piping issues
node -e "
  const data = JSON.parse(process.argv[1]);
  const dead = [];
  data.forEach(f => {
    const name = f.filePath.replace(/.*[\\\\/]/, '');
    if (f.errorCount === 0) dead.push(name);
  });
  if (dead.length > 0) {
    console.error('❌ DEAD RULES — canary passed with 0 errors:', dead.join(', '));
    process.exit(1);
  }
  console.log('✅ All', data.length, 'canaries triggered errors');
" "$ERRORS"
