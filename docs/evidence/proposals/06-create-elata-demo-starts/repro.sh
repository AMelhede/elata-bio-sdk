#!/usr/bin/env bash
# Fix 6, the starter-app maker crashes on start. Needs only npm and network access; run it in an empty folder.
#   bash repro.sh [version]      default 0.12.1, the version npm tags latest today
# Prints the exit code. Published versions 0.3.1 to 0.12.1 exit 1 with
# "Missing packaged SDK version metadata for @elata-biosciences/app-metrics". Good is exit 0 and a template list.
set -u
V="${1:-0.12.1}"
# Self-check: the version asked for exists on npm, so a failure below is the package, not a typo or the network.
if ! npm view "@elata-biosciences/create-elata-demo@$V" version >/dev/null 2>&1; then
  echo "self-check failed: @elata-biosciences/create-elata-demo@$V is not on npm (or npm cannot reach the registry)"; exit 2
fi
echo "self-check ok: @elata-biosciences/create-elata-demo@$V exists; node $(node -v), npm $(npm -v)"
npx --yes "@elata-biosciences/create-elata-demo@$V" --list-templates
echo "exit code: $?"
echo "what the package carries (no appMetrics key is the defect):"
npm view "@elata-biosciences/create-elata-demo@$V" elataSdkVersions
