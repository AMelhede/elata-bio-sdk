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

assert_file_is() {
    local file="$1" actual expected
    shift
    actual="$(<"$file")"
    expected="$(printf '%s\n' "$@")"
    if [[ "$actual" != "$expected" ]]; then
        printf -- "---- expected %s ----\n%s\n---- actual ----\n%s\n----------------\n" "$file" "$expected" "$actual" >&2
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

unlink_overrides() {
    RUN_SH_INTERNAL_TEST=1 "$ROOT_DIR/run.sh" __selftest_unlink_overrides "$1"
}

# Writes <app>/pnpm-workspace.yaml from the remaining arguments, one line each.
write_workspace_file() {
    local app="$1"
    shift
    mkdir -p "$app"
    printf '%s\n' "$@" >"$app/pnpm-workspace.yaml"
}

test_unlink_removes_only_link_overrides() {
    local dir out
    dir="$(mktemp -d)"

    # A starter's own workspace file after `pnpm link`: the link goes, everything else stays.
    write_workspace_file "$dir/starter" "# comment" "packages:" "  - ." "allowBuilds:" "  esbuild: true" "overrides:" \
        "  '@elata-biosciences/rppg-web': link:../../elata-bio-sdk/packages/rppg-web"
    unlink_overrides "$dir/starter"
    out="$(<"$dir/starter/pnpm-workspace.yaml")"
    assert_contains "$out" "packages:"
    assert_contains "$out" "esbuild: true"
    if [[ "$out" == *"link:"* || "$out" == *"overrides:"* ]]; then
        fail "link override or empty overrides key left behind: $out"
    fi

    # Another override in the same block is kept, with its key.
    write_workspace_file "$dir/mixed" "overrides:" "  foo: 1.2.3" "  '@elata-biosciences/eeg-web': link:../eeg-web" "packages:" "  - ."
    unlink_overrides "$dir/mixed"
    out="$(<"$dir/mixed/pnpm-workspace.yaml")"
    assert_contains "$out" "overrides:"
    assert_contains "$out" "foo: 1.2.3"
    assert_contains "$out" "packages:"
    if [[ "$out" == *"link:"* ]]; then
        fail "link override left behind: $out"
    fi

    # The override-only file pnpm creates for an app without a workspace file is removed.
    write_workspace_file "$dir/only" "overrides:" "  '@elata-biosciences/rppg-web': link:../rppg-web"
    unlink_overrides "$dir/only"
    if [[ -e "$dir/only/pnpm-workspace.yaml" ]]; then
        fail "override-only workspace file was not removed"
    fi

    # Blank lines and comments inside the block do not end it. This is the layout pnpm 10.33.2
    # writes when the app's own overrides are separated by a blank line: the link sorts first and
    # the blank line follows it. The other overrides must stay under `overrides:`, not slide under
    # the key above it.
    write_workspace_file "$dir/blank" "packages:" "  - ." "allowBuilds:" "  esbuild: true" "overrides:" \
        "  '@elata-biosciences/rppg-web': link:../rppg-web" "" "  react: 18.3.1" "  zod: 3.23.8"
    unlink_overrides "$dir/blank"
    assert_file_is "$dir/blank/pnpm-workspace.yaml" "packages:" "  - ." "allowBuilds:" "  esbuild: true" "overrides:" \
        "" "  react: 18.3.1" "  zod: 3.23.8"

    write_workspace_file "$dir/comment" "overrides:" "# pinned on purpose" "  '@elata-biosciences/rppg-web': link:../rppg-web" \
        "  zod: 3.23.8" "packages:" "  - ."
    unlink_overrides "$dir/comment"
    assert_file_is "$dir/comment/pnpm-workspace.yaml" "overrides:" "# pinned on purpose" "  zod: 3.23.8" "packages:" "  - ."

    # A comment after the key is still the key.
    write_workspace_file "$dir/keycomment" "packages:" "  - ." "overrides: # local builds" "  '@elata-biosciences/rppg-web': link:../rppg-web"
    unlink_overrides "$dir/keycomment"
    assert_file_is "$dir/keycomment/pnpm-workspace.yaml" "packages:" "  - ."

    # pnpm 10 writes the link into package.json's pnpm.overrides instead when package.json has a
    # "pnpm" field. That link goes too; the other override, the rest of the field and a dependency
    # the app itself declares as link: stay, and so does the file's indentation.
    mkdir -p "$dir/pkg" "$dir/pkgonly"
    printf '%s\n' '{' '  "name": "app",' '  "dependencies": {' '    "local-thing": "link:../local-thing"' '  },' \
        '  "pnpm": {' '    "onlyBuiltDependencies": [' '      "esbuild"' '    ],' '    "overrides": {' \
        '      "@elata-biosciences/rppg-web": "link:../rppg-web",' '      "zod": "3.23.8"' '    }' '  }' '}' >"$dir/pkg/package.json"
    unlink_overrides "$dir/pkg"
    assert_file_is "$dir/pkg/package.json" '{' '  "name": "app",' '  "dependencies": {' '    "local-thing": "link:../local-thing"' '  },' \
        '  "pnpm": {' '    "onlyBuiltDependencies": [' '      "esbuild"' '    ],' '    "overrides": {' '      "zod": "3.23.8"' '    }' '  }' '}'

    # An overrides object, and then a pnpm field, left empty are dropped, like the workspace key.
    printf '{\n\t"name": "app",\n\t"pnpm": {\n\t\t"overrides": {\n\t\t\t"@elata-biosciences/rppg-web": "link:../rppg-web"\n\t\t}\n\t}\n}\n' >"$dir/pkgonly/package.json"
    unlink_overrides "$dir/pkgonly"
    assert_file_is "$dir/pkgonly/package.json" '{' $'\t"name": "app"' '}'

    # A link this cannot edit (overrides written inline) fails loudly instead of being reported as
    # unlinked, and the file is left as it was.
    write_workspace_file "$dir/inline" "packages:" "  - ." "overrides: { '@elata-biosciences/rppg-web': 'link:../rppg-web' }"
    run_and_capture_stderr "$dir/inline.err" unlink_overrides "$dir/inline"
    if [[ "$RUN_SH_TEST_RC" -eq 0 ]]; then
        fail "unlink reported success with an inline link override left in place"
    fi
    assert_contains "$(<"$dir/inline.err")" "link:"
    assert_file_is "$dir/inline/pnpm-workspace.yaml" "packages:" "  - ." "overrides: { '@elata-biosciences/rppg-web': 'link:../rppg-web' }"

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

