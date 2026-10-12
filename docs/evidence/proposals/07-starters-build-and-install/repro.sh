#!/usr/bin/env bash
# Fix 7, new starter apps do not build (npm) or install (current pnpm). Run from the root of an Elata SDK checkout
# (main, or a fix branch), because the published maker crashes first (fix 6). Needs node, npm and network access.
#   bash repro.sh [template]     default rppg-demo
# On main: npm run build exits 1 with "[vite-plugin-top-level-await] missing field `type`", and
# npx pnpm@11 install exits 1 with ERR_PNPM_IGNORED_BUILDS. Good is exit 0 for both.
set -u
T="${1:-rppg-demo}"
# Self-check: this is an SDK checkout with the maker in it, and the template exists.
if [ ! -f packages/create-elata-demo/index.mjs ] || [ ! -d "packages/create-elata-demo/templates/$T" ]; then
  echo "self-check failed: run from an Elata SDK checkout root; template $T not found"; exit 2
fi
echo "self-check ok: maker and template $T found; node $(node -v), npm $(npm -v)"
D="$(mktemp -d)"
node packages/create-elata-demo/index.mjs "$D/app" --template "$T" >/dev/null || { echo "maker failed (fix 6 not in this checkout?)"; exit 1; }
( cd "$D/app" && npm install --no-audit --no-fund >/dev/null 2>&1; npm run build > build.log 2>&1; echo "npm run build exit code: $?"; grep -m1 -o "missing field .type." build.log || true )
rm -rf "$D/app/node_modules" "$D/app/package-lock.json"
( cd "$D/app" && npx --yes pnpm@11 install > pnpm.log 2>&1; echo "pnpm 11 install exit code: $?"; grep -m1 -o "ERR_PNPM_IGNORED_BUILDS" pnpm.log || true )
rm -rf "$D"
