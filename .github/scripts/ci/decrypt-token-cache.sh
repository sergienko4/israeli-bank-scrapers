#!/usr/bin/env bash
# decrypt-token-cache.sh — decrypt a bank's long-term OTP JWT from the
# encrypted Actions-cache payload into the plaintext file that
# src/Tests/E2eReal/TokenCache.ts reads via `<tmpdir>/<bank>-token.cache`.
#
# Why: GitHub Actions cache content is accessible to any contributor
# with repo read access via PR jobs (the repo is PUBLIC). Bank JWTs
# must therefore travel through the cache as ciphertext. GPG symmetric
# encryption with AES-256 + MDC packet gives authenticated encryption
# (tamper detection); preferred over `openssl enc -aes-256-cbc` which
# is not authenticated.
#
# Usage:
#   CACHE_KEY=<32-byte hex> bash .github/scripts/ci/decrypt-token-cache.sh <Bank>
#
# Inputs:
#   $1            — Bank name (OneZero | Pepper | PayBox).
#   $CACHE_KEY    — 32-byte hex symmetric passphrase (repo secret
#                   TOKEN_CACHE_KEY). When unset OR empty, exits 0
#                   without action (graceful degradation: tests will
#                   walk full OTP flow).
#
# Output:
#   /tmp/<bank-lower>-token.cache  — plaintext JWT (chmod 0600).
#
# Exit codes:
#   0  success or graceful skip (no cache, no key, etc.)
#   1  decryption failed (bad key, tampered ciphertext) — surface so
#      operators rotate TOKEN_CACHE_KEY or invalidate the cache.

set -euo pipefail

BANK_TITLE="${1:?usage: decrypt-token-cache.sh <Bank>}"
BANK_LOWER=$(printf '%s' "$BANK_TITLE" | tr '[:upper:]' '[:lower:]')
ENC_FILE="/tmp/tokens-encrypted/${BANK_LOWER}-token.cache.gpg"
PLAIN_FILE="/tmp/${BANK_LOWER}-token.cache"

if [ ! -f "$ENC_FILE" ]; then
  echo "::notice title=TokenCache::no cached token for ${BANK_TITLE} (cold start)"
  exit 0
fi

if [ -z "${CACHE_KEY:-}" ]; then
  echo "::warning title=TokenCache::TOKEN_CACHE_KEY not set — skipping decrypt for ${BANK_TITLE} (cold path will run)"
  exit 0
fi

# GPG symmetric decrypt with the passphrase piped via fd 3 (keeps it
# off the process arg list, off the env table of subprocesses).
if ! gpg --batch --quiet --yes --pinentry-mode loopback \
        --passphrase-fd 3 \
        --output "$PLAIN_FILE" \
        --decrypt "$ENC_FILE" 3<<<"$CACHE_KEY"; then
  echo "::error title=TokenCache::decrypt failed for ${BANK_TITLE} — TOKEN_CACHE_KEY mismatch or cache tampered. Rotate the key and clear the cache."
  rm -f "$PLAIN_FILE"
  exit 1
fi

chmod 600 "$PLAIN_FILE"
TOKEN_LEN=$(wc -c <"$PLAIN_FILE" | tr -d ' ')
echo "::notice title=TokenCache::decrypted ${BANK_TITLE} (token length=${TOKEN_LEN})"
