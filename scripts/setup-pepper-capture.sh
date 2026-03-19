#!/usr/bin/env bash
# ============================================================================
# Pepper Bank API Traffic Capture — Full Setup Script
# ============================================================================
#
# Sets up: Android SDK (cmdline-tools), emulator, mitmproxy, Frida, APK tools
# Then launches the full traffic capture environment for Pepper (com.pepper.ldb)
#
# Prerequisites: Windows 11, Java 17+, Python 3.10+, pip
# Disk: ~15GB free (SDK + emulator image + tools)
#
# Usage:
#   bash scripts/setup-pepper-capture.sh install    # One-time: install all tools
#   bash scripts/setup-pepper-capture.sh emulator   # Start emulator only
#   bash scripts/setup-pepper-capture.sh capture     # Start full capture session
#   bash scripts/setup-pepper-capture.sh apk-scan   # Static APK analysis only
#   bash scripts/setup-pepper-capture.sh spec        # Generate API spec from flows
# ============================================================================

set -euo pipefail

# ── Windows PATH fixes ────────────────────────────────────────────────────
# Git Bash doesn't inherit all Windows PATH entries. Add common tool locations.

# Java (Adoptium / Oracle)
for d in "/c/Program Files/Eclipse Adoptium"/jdk-*/bin \
         "/c/Program Files/Java"/jdk-*/bin \
         "/c/Program Files/Common Files/Oracle/Java/javapath"; do
  [ -d "$d" ] && export PATH="$d:$PATH"
done

# Python user scripts (pip install --user)
PYTHON_USER_SCRIPTS="$(python -m site --user-base 2>/dev/null)/Scripts"
[ -d "$PYTHON_USER_SCRIPTS" ] && export PATH="$PYTHON_USER_SCRIPTS:$PATH"

# Python global scripts
for d in "/c/Python3"*/Scripts "/c/Users/$(whoami)/AppData/Local/Programs/Python/Python3"*/Scripts; do
  [ -d "$d" ] && export PATH="$d:$PATH"
done

# Android SDK — cmdline-tools ship as .bat on Windows
ANDROID_HOME="${ANDROID_HOME:-C:/Android}"
export ANDROID_HOME
export PATH="${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${ANDROID_HOME}/emulator:${PATH}"

# Wrapper functions for .bat SDK tools (Git Bash can't find them without extension)
sdkmanager()  { "${ANDROID_HOME}/cmdline-tools/latest/bin/sdkmanager.bat" "$@"; }
avdmanager()  { "${ANDROID_HOME}/cmdline-tools/latest/bin/avdmanager.bat" "$@"; }
export -f sdkmanager avdmanager 2>/dev/null || true

# ── Configuration ──────────────────────────────────────────────────────────

AVD_NAME="pepper-capture"
SYSTEM_IMAGE="system-images;android-33;google_apis;x86_64"
PEPPER_PACKAGE="com.pepper.ldb"
MITM_PORT=8080
FLOWS_FILE="pepper-flows.mitm"
APK_FILE="${APK_FILE:-pepper.apk}"

# Frida server version — match your frida-tools version
FRIDA_VERSION="16.6.6"
FRIDA_SERVER_URL="https://github.com/frida/frida/releases/download/${FRIDA_VERSION}/frida-server-${FRIDA_VERSION}-android-x86_64.xz"

# SSL pinning bypass script
SSL_BYPASS_URL="https://raw.githubusercontent.com/httptoolkit/frida-android-unpinning/main/frida-script.js"

# Output directories
CAPTURE_DIR="$(pwd)/capture"
DECOMPILED_DIR="${CAPTURE_DIR}/pepper-decompiled"

# ── Colors ─────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[x]${NC} $*" >&2; }
step() { echo -e "\n${BLUE}══════════════════════════════════════${NC}"; echo -e "${BLUE}  $*${NC}"; echo -e "${BLUE}══════════════════════════════════════${NC}\n"; }

# ── Helpers ────────────────────────────────────────────────────────────────

check_cmd() {
  if ! command -v "$1" &>/dev/null; then
    err "$1 not found. $2"
    return 1
  fi
  log "$1 found: $(command -v "$1")"
}

wait_for_device() {
  log "Waiting for emulator to boot..."
  adb wait-for-device
  local boot=""
  while [ "$boot" != "1" ]; do
    boot=$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || echo "")
    sleep 2
  done
  log "Emulator booted successfully"
}

get_host_ip() {
  # Get host IP for proxy (Windows)
  powershell -Command "(Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias 'Wi-Fi*','Ethernet*' | Where-Object { \$_.IPAddress -notlike '169.*' } | Select-Object -First 1).IPAddress" 2>/dev/null | tr -d '\r'
}

# ── Command: install ───────────────────────────────────────────────────────

cmd_install() {
  step "Phase 1: Checking prerequisites"

  check_cmd java "Install JDK 17: winget install EclipseAdoptium.Temurin.17.JDK"
  check_cmd python "Install Python 3.10+: winget install Python.Python.3.13"
  check_cmd pip "pip should come with Python"

  step "Phase 2: Installing Android SDK command-line tools"

  if [ -d "${ANDROID_HOME}/cmdline-tools/latest/bin" ]; then
    log "Android cmdline-tools already installed at ${ANDROID_HOME}"
  else
    log "Downloading Android command-line tools..."
    mkdir -p "${ANDROID_HOME}"

    local TOOLS_URL="https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"
    local TOOLS_ZIP="${CAPTURE_DIR}/cmdline-tools.zip"
    mkdir -p "${CAPTURE_DIR}"

    curl -L -o "${TOOLS_ZIP}" "${TOOLS_URL}"
    log "Extracting to ${ANDROID_HOME}/cmdline-tools/latest/"

    # Unzip to temp, then move to correct structure
    local TEMP_DIR="${ANDROID_HOME}/cmdline-tools-temp"
    unzip -qo "${TOOLS_ZIP}" -d "${TEMP_DIR}"
    mkdir -p "${ANDROID_HOME}/cmdline-tools"
    mv "${TEMP_DIR}/cmdline-tools" "${ANDROID_HOME}/cmdline-tools/latest"
    rm -rf "${TEMP_DIR}" "${TOOLS_ZIP}"
  fi

  log "ANDROID_HOME=${ANDROID_HOME}"
  warn "Add these to your system PATH permanently:"
  echo "  ANDROID_HOME=${ANDROID_HOME}"
  echo "  PATH += ${ANDROID_HOME}/cmdline-tools/latest/bin"
  echo "  PATH += ${ANDROID_HOME}/platform-tools"
  echo "  PATH += ${ANDROID_HOME}/emulator"

  step "Phase 3: Installing Android SDK components"

  log "Accepting licenses..."
  yes | sdkmanager --licenses 2>/dev/null || true

  log "Installing platform-tools, emulator, and system image..."
  sdkmanager --install "platform-tools" "emulator" "${SYSTEM_IMAGE}"

  step "Phase 4: Creating Android Virtual Device"

  if avdmanager list avd 2>/dev/null | grep -q "${AVD_NAME}"; then
    log "AVD '${AVD_NAME}' already exists"
  else
    log "Creating AVD '${AVD_NAME}'..."
    echo "no" | avdmanager create avd -n "${AVD_NAME}" -k "${SYSTEM_IMAGE}" --device "pixel_6"
    log "AVD created"
  fi

  step "Phase 5: Installing Python tools"

  log "Installing mitmproxy..."
  pip install --user mitmproxy 2>/dev/null || pip install mitmproxy

  log "Installing frida-tools..."
  pip install --user frida-tools 2>/dev/null || pip install frida-tools

  log "Installing mitmproxy2swagger..."
  pip install --user mitmproxy2swagger 2>/dev/null || pip install mitmproxy2swagger

  log "Installing apkleaks (for static APK analysis)..."
  pip install --user apkleaks 2>/dev/null || pip install apkleaks

  step "Phase 6: Downloading Frida server for Android"

  mkdir -p "${CAPTURE_DIR}"
  local FRIDA_BIN="${CAPTURE_DIR}/frida-server"

  if [ -f "${FRIDA_BIN}" ]; then
    log "Frida server already downloaded"
  else
    log "Downloading frida-server ${FRIDA_VERSION} for android-x86_64..."
    curl -L "${FRIDA_SERVER_URL}" | xz -d > "${FRIDA_BIN}"
    chmod +x "${FRIDA_BIN}"
    log "Frida server saved to ${FRIDA_BIN}"
  fi

  step "Phase 7: Downloading SSL pinning bypass script"

  local SSL_SCRIPT="${CAPTURE_DIR}/ssl-pinning-bypass.js"

  if [ -f "${SSL_SCRIPT}" ]; then
    log "SSL bypass script already downloaded"
  else
    log "Downloading universal SSL pinning bypass..."
    curl -L -o "${SSL_SCRIPT}" "${SSL_BYPASS_URL}"
    log "Script saved to ${SSL_SCRIPT}"
  fi

  step "Installation complete!"
  echo ""
  log "Next steps:"
  echo "  1. Download Pepper APK from APKMirror (com.pepper.ldb)"
  echo "     Save as: ${APK_FILE}"
  echo "  2. Run: bash scripts/setup-pepper-capture.sh emulator"
  echo "  3. Run: bash scripts/setup-pepper-capture.sh capture"
  echo ""
  warn "Remember to add ANDROID_HOME and PATH to your system environment!"
}

# ── Command: emulator ──────────────────────────────────────────────────────

cmd_emulator() {
  step "Starting Android emulator"

  check_cmd emulator "Run 'install' first"
  check_cmd adb "Run 'install' first"

  log "Launching emulator '${AVD_NAME}' with writable system..."
  emulator -avd "${AVD_NAME}" -writable-system -gpu host -no-snapshot-load &
  local EMU_PID=$!

  wait_for_device

  log "Emulator running (PID: ${EMU_PID})"
  log "Installing Pepper APK..."

  if [ -f "${APK_FILE}" ]; then
    adb install -r "${APK_FILE}" && log "Pepper installed" || warn "APK install failed — may need different version"
  else
    warn "APK not found at ${APK_FILE}"
    warn "Download from APKMirror and save as: ${APK_FILE}"
  fi

  echo ""
  log "Emulator is ready. Next: bash scripts/setup-pepper-capture.sh capture"
}

# ── Command: capture ───────────────────────────────────────────────────────

cmd_capture() {
  step "Setting up traffic capture environment"

  export ANDROID_HOME="${ANDROID_HOME}"
  export PATH="${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${ANDROID_HOME}/emulator:${PATH}"

  check_cmd adb "Start emulator first"
  check_cmd mitmweb "Run 'install' first"
  check_cmd frida "Run 'install' first"

  mkdir -p "${CAPTURE_DIR}"
  local FRIDA_BIN="${CAPTURE_DIR}/frida-server"
  local SSL_SCRIPT="${CAPTURE_DIR}/ssl-pinning-bypass.js"

  # Verify emulator is running
  if ! adb devices | grep -q "emulator"; then
    err "No emulator detected. Run: bash scripts/setup-pepper-capture.sh emulator"
    exit 1
  fi

  # Step 1: Install mitmproxy CA certificate as system cert
  step "Step 1: Installing mitmproxy CA certificate"

  # Generate cert if not exists
  if [ ! -f ~/.mitmproxy/mitmproxy-ca-cert.cer ]; then
    log "Generating mitmproxy certificates (first run)..."
    mitmdump --set confdir=~/.mitmproxy -p 0 &
    local TMP_PID=$!
    sleep 3
    kill $TMP_PID 2>/dev/null || true
  fi

  log "Pushing CA cert to emulator system store..."
  adb root
  sleep 2
  adb remount

  local CERT_HASH
  CERT_HASH=$(openssl x509 -inform PEM -subject_hash_old -in ~/.mitmproxy/mitmproxy-ca-cert.cer 2>/dev/null | head -1)
  local CERT_PATH="/system/etc/security/cacerts/${CERT_HASH}.0"

  adb push ~/.mitmproxy/mitmproxy-ca-cert.cer "${CERT_PATH}"
  adb shell chmod 644 "${CERT_PATH}"
  log "CA cert installed as ${CERT_PATH}"

  # Step 2: Set proxy
  step "Step 2: Configuring proxy"

  local HOST_IP
  HOST_IP=$(get_host_ip)

  if [ -z "${HOST_IP}" ]; then
    warn "Could not auto-detect host IP. Enter manually:"
    read -rp "Host IP: " HOST_IP
  fi

  adb shell settings put global http_proxy "${HOST_IP}:${MITM_PORT}"
  log "Proxy set to ${HOST_IP}:${MITM_PORT}"

  # Step 3: Push and start Frida server
  step "Step 3: Starting Frida server on emulator"

  adb push "${FRIDA_BIN}" /data/local/tmp/frida-server
  adb shell chmod 755 /data/local/tmp/frida-server

  # Kill existing frida-server if running
  adb shell "pkill -f frida-server" 2>/dev/null || true
  sleep 1

  adb shell "/data/local/tmp/frida-server &" &
  sleep 3
  log "Frida server started"

  # Step 4: Start mitmweb
  step "Step 4: Starting mitmproxy web UI"

  log "Starting mitmweb on port ${MITM_PORT}..."
  log "Web UI will open at: http://127.0.0.1:8081"
  mitmweb --listen-port "${MITM_PORT}" -w "${CAPTURE_DIR}/${FLOWS_FILE}" &
  local MITM_PID=$!
  sleep 3

  # Step 5: Launch Pepper with Frida SSL bypass
  step "Step 5: Launching Pepper with SSL pinning bypass"

  log "Spawning ${PEPPER_PACKAGE} with Frida..."
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "  CAPTURE SESSION ACTIVE"
  echo ""
  echo "  mitmproxy web UI: http://127.0.0.1:8081"
  echo "  Flows saved to:   ${CAPTURE_DIR}/${FLOWS_FILE}"
  echo ""
  echo "  Instructions:"
  echo "  1. Log in to Pepper app (phone + OTP)"
  echo "  2. Navigate to transaction history"
  echo "  3. Scroll through transactions"
  echo "  4. Check account balance"
  echo "  5. Press Ctrl+C when done capturing"
  echo ""
  echo "  After capture, run:"
  echo "    bash scripts/setup-pepper-capture.sh spec"
  echo "═══════════════════════════════════════════════════════════════"
  echo ""

  # This blocks until user presses Ctrl+C
  frida -U -f "${PEPPER_PACKAGE}" -l "${SSL_SCRIPT}" --no-pause || true

  # Cleanup
  log "Stopping mitmproxy..."
  kill $MITM_PID 2>/dev/null || true

  log "Removing proxy from emulator..."
  adb shell settings put global http_proxy :0

  step "Capture session complete"
  log "Flows saved to: ${CAPTURE_DIR}/${FLOWS_FILE}"
  log "Generate API spec: bash scripts/setup-pepper-capture.sh spec"
}

# ── Command: apk-scan ──────────────────────────────────────────────────────

cmd_apk_scan() {
  step "Static APK Analysis"

  check_cmd apkleaks "pip install apkleaks"

  if [ ! -f "${APK_FILE}" ]; then
    err "APK not found at ${APK_FILE}"
    err "Download Pepper APK from APKMirror and save as: ${APK_FILE}"
    exit 1
  fi

  mkdir -p "${CAPTURE_DIR}"

  log "Running APKLeaks — extracting URLs, endpoints, secrets..."
  apkleaks -f "${APK_FILE}" -o "${CAPTURE_DIR}/pepper-endpoints.txt" || true

  log "Results saved to: ${CAPTURE_DIR}/pepper-endpoints.txt"

  if command -v jadx &>/dev/null; then
    log "Running JADX decompilation..."
    jadx "${APK_FILE}" -d "${DECOMPILED_DIR}" --no-res 2>/dev/null || true

    log "Searching for API URLs..."
    grep -rn "https://" "${DECOMPILED_DIR}/sources/" 2>/dev/null \
      | grep -iE "pepper|leumi|api|auth|login|otp" \
      > "${CAPTURE_DIR}/pepper-urls.txt" || true

    log "Searching for auth patterns..."
    grep -rn -iE "Bearer|Authorization|token|access.?token|refresh.?token" "${DECOMPILED_DIR}/sources/" 2>/dev/null \
      > "${CAPTURE_DIR}/pepper-auth-patterns.txt" || true

    log "Searching for certificate pinning..."
    grep -rn -iE "CertificatePinner|TrustManager|ssl.?pin|cert.?pin" "${DECOMPILED_DIR}/sources/" 2>/dev/null \
      > "${CAPTURE_DIR}/pepper-cert-pinning.txt" || true

    log "Results saved to ${CAPTURE_DIR}/"
    echo "  - pepper-urls.txt (API endpoints)"
    echo "  - pepper-auth-patterns.txt (auth headers/tokens)"
    echo "  - pepper-cert-pinning.txt (SSL pinning config)"
  else
    warn "JADX not installed. Install with: choco install jadx"
    warn "Skipping deep decompilation analysis"
  fi

  step "APK scan complete"
  log "Review: ${CAPTURE_DIR}/pepper-endpoints.txt"
}

# ── Command: spec ──────────────────────────────────────────────────────────

cmd_spec() {
  step "Generating API specification from captured traffic"

  check_cmd mitmproxy2swagger "pip install mitmproxy2swagger"

  local FLOWS="${CAPTURE_DIR}/${FLOWS_FILE}"
  if [ ! -f "${FLOWS}" ]; then
    err "No flow file found at ${FLOWS}"
    err "Run 'capture' first to record traffic"
    exit 1
  fi

  log "Generating OpenAPI spec..."
  mitmproxy2swagger -i "${FLOWS}" -o "${CAPTURE_DIR}/pepper-api-spec.yaml" -p "https://" --examples

  step "API spec generated"
  log "OpenAPI spec: ${CAPTURE_DIR}/pepper-api-spec.yaml"
  log "Review the spec and update the plan with actual endpoints"
}

# ── Main ───────────────────────────────────────────────────────────────────

case "${1:-help}" in
  install)  cmd_install ;;
  emulator) cmd_emulator ;;
  capture)  cmd_capture ;;
  apk-scan) cmd_apk_scan ;;
  spec)     cmd_spec ;;
  *)
    echo "Pepper Bank API Traffic Capture Setup"
    echo ""
    echo "Usage: bash scripts/setup-pepper-capture.sh <command>"
    echo ""
    echo "Commands:"
    echo "  install   One-time setup: Android SDK, emulator, mitmproxy, Frida"
    echo "  emulator  Start the Android emulator"
    echo "  capture   Start full traffic capture session (emulator must be running)"
    echo "  apk-scan  Static APK analysis (extract endpoints without running app)"
    echo "  spec      Generate OpenAPI spec from captured traffic"
    echo ""
    echo "Workflow:"
    echo "  1. bash scripts/setup-pepper-capture.sh install"
    echo "  2. Download pepper.apk from APKMirror"
    echo "  3. bash scripts/setup-pepper-capture.sh emulator"
    echo "  4. bash scripts/setup-pepper-capture.sh capture"
    echo "  5. Use Pepper app (login, browse transactions)"
    echo "  6. Ctrl+C to stop capture"
    echo "  7. bash scripts/setup-pepper-capture.sh spec"
    ;;
esac
