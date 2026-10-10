#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
    printf "run-sh-tests: %s\n" "$*" >&2
    exit 1
}

assert_contains() {
    local haystack="$1"
    local needle="$2"
    if [[ "$haystack" != *"$needle"* ]]; then
        printf "Expected output to contain: %s\n" "$needle" >&2
        printf "---- output ----\n%s\n----------------\n" "$haystack" >&2
        exit 1
    fi
}

run_and_capture_stderr() {
    local logfile="$1"
    shift
    RUN_SH_TEST_RC=0
    set +e
    "$@" 2>"$logfile" 1>/dev/null
    RUN_SH_TEST_RC=$?
    set -e
    return 0
}

test_err_trap_has_context() {
    local tmp out
    tmp="$(mktemp)"
    run_and_capture_stderr "$tmp" env RUN_SH_INTERNAL_TEST=1 "$ROOT_DIR/run.sh" __selftest_errtrap
    out="$(<"$tmp")"
    rm -f "$tmp"
    if [[ ${RUN_SH_TEST_RC:-0} -eq 0 ]]; then
        fail "expected __selftest_errtrap to fail"
    fi
    assert_contains "$out" "Command failed (task: __selftest_errtrap)"
    assert_contains "$out" "while running: false"
    assert_contains "$out" "Hint:"
}

test_require_cmd_is_actionable() {
    local tmp out
    tmp="$(mktemp)"
    run_and_capture_stderr "$tmp" env RUN_SH_INTERNAL_TEST=1 "$ROOT_DIR/run.sh" __selftest_requirecmd
    out="$(<"$tmp")"
    rm -f "$tmp"
    if [[ ${RUN_SH_TEST_RC:-0} -eq 0 ]]; then
        fail "expected __selftest_requirecmd to fail"
    fi
    assert_contains "$out" "Error: Missing required command: __definitely_missing_command__"
    assert_contains "$out" "Hint: Install '__definitely_missing_command__' and retry"
}

test_unknown_command_still_shows_usage() {
    set +e
    local out rc
    out="$("$ROOT_DIR/run.sh" __definitely_unknown_cmd__ 2>&1)"
    rc=$?
    set -e
    if [[ $rc -eq 0 ]]; then
        fail "expected unknown command to fail"
    fi
    assert_contains "$out" "Unknown command: __definitely_unknown_cmd__"
    assert_contains "$out" "Usage:"
}

test_unlink_removes_only_link_overrides() {
    local dir out
    dir="$(mktemp -d)"

    # A starter's own workspace file after `pnpm link`: the link goes, everything else stays.
    printf '%s\n' "# comment" "packages:" "  - ." "allowBuilds:" "  esbuild: true" "overrides:" \
        "  '@elata-biosciences/rppg-web': link:../../elata-bio-sdk/packages/rppg-web" >"$dir/starter.yaml"
    RUN_SH_INTERNAL_TEST=1 "$ROOT_DIR/run.sh" __selftest_unlink_overrides "$dir/starter.yaml"
    out="$(<"$dir/starter.yaml")"
    assert_contains "$out" "packages:"
    assert_contains "$out" "esbuild: true"
    if [[ "$out" == *"link:"* || "$out" == *"overrides:"* ]]; then
        fail "link override or empty overrides key left behind: $out"
    fi

    # Another override in the same block is kept, with its key.
    printf '%s\n' "overrides:" "  foo: 1.2.3" "  '@elata-biosciences/eeg-web': link:../eeg-web" "packages:" "  - ." >"$dir/mixed.yaml"
    RUN_SH_INTERNAL_TEST=1 "$ROOT_DIR/run.sh" __selftest_unlink_overrides "$dir/mixed.yaml"
    out="$(<"$dir/mixed.yaml")"
    assert_contains "$out" "overrides:"
    assert_contains "$out" "foo: 1.2.3"
    assert_contains "$out" "packages:"
    if [[ "$out" == *"link:"* ]]; then
        fail "link override left behind: $out"
    fi

    # The override-only file pnpm creates for an app without a workspace file is removed.
    printf '%s\n' "overrides:" "  '@elata-biosciences/rppg-web': link:../rppg-web" >"$dir/only.yaml"
    RUN_SH_INTERNAL_TEST=1 "$ROOT_DIR/run.sh" __selftest_unlink_overrides "$dir/only.yaml"
    if [[ -e "$dir/only.yaml" ]]; then
        fail "override-only workspace file was not removed"
    fi

    rm -rf "$dir"
}

main() {
    test_err_trap_has_context
    test_require_cmd_is_actionable
    test_unknown_command_still_shows_usage
    test_unlink_removes_only_link_overrides
    printf "run-sh-tests: ok\n"
}

main "$@"

