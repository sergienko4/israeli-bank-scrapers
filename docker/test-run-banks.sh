#!/usr/bin/env bash
# Offline regression checks; requires the same Bash 4+ as run-banks.sh.
set -euo pipefail
umask 077

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE="$(mktemp -d)"

cleanup() {
    rm -f "$FIXTURE/bin/docker" "$FIXTURE/.env" "$FIXTURE/output.log" "$FIXTURE/docker-args" \
        "$FIXTURE/docker/run-banks.sh" "$FIXTURE/docker/logs/Beinleumi.log" \
        "$FIXTURE/docker/logs/Beinleumi.log.exit"
    if [ -d "$FIXTURE/docker/logs/Beinleumi.runs" ]; then
        rmdir "$FIXTURE/docker/logs/Beinleumi.runs"
    fi
    rmdir "$FIXTURE/docker/logs" "$FIXTURE/docker" "$FIXTURE/bin" "$FIXTURE"
}
trap cleanup EXIT

mkdir -p "$FIXTURE/bin" "$FIXTURE/docker/logs"
cp "$REPO_ROOT/docker/run-banks.sh" "$FIXTURE/docker/run-banks.sh"
printf 'BEINLEUMI_USERNAME=fixture\nBEINLEUMI_PASSWORD=fixture\n' > "$FIXTURE/.env"
cat > "$FIXTURE/bin/docker" <<'STUB'
#!/usr/bin/env bash
case "$1" in
    image) exit 0 ;;
    run)
        printf '%s\n' "$@" > "$FAKE_DOCKER_ARGS"
        printf 'Test Suites: synthetic container output without legacy pipeline markers\n'
        exit "$FAKE_DOCKER_EXIT"
        ;;
    *) exit 99 ;;
esac
STUB
chmod +x "$FIXTURE/bin/docker"

run_case() {
    local container_exit="$1" expected_exit="$2" label="$3" actual_exit=0
    FAKE_DOCKER_EXIT="$container_exit" FAKE_DOCKER_ARGS="$FIXTURE/docker-args" \
        PATH="$FIXTURE/bin:$PATH" \
        bash "$FIXTURE/docker/run-banks.sh" Beinleumi > "$FIXTURE/output.log" 2>&1 \
        || actual_exit=$?
    if [ "$actual_exit" -ne "$expected_exit" ]; then
        cat "$FIXTURE/output.log"
        echo "Expected wrapper exit $expected_exit for container exit $container_exit; got $actual_exit" >&2
        return 1
    fi
    grep -Eq "^  Beinleumi[[:space:]]+$label[[:space:]]" "$FIXTURE/output.log"
    test "$(cat "$FIXTURE/docker/logs/Beinleumi.log.exit")" = "$container_exit"
    grep -Fxq "$FIXTURE/docker/logs/Beinleumi.runs:/tmp/runs" "$FIXTURE/docker-args"
    printf 'Container exit %s: wrapper exit %s and %s summary\n' \
        "$container_exit" "$actual_exit" "$label"
}

run_case 7 1 FAIL
run_case 0 0 PASS
