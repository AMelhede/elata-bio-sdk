#!/usr/bin/env bash
# Fix 8, two packages cannot be installed with npm. Needs only npm and network access.
#   bash repro.sh
# Today: eeg-web with eeg-web-ble fails ERESOLVE (peer eeg-web ^0.2.1), and eeg-web-ble or ppg-web alone fail
# ETARGET (no published eeg-web matches ^0.2.1). Good is exit 0 for all three.
set -u
# Self-check: the registry answers and lists eeg-web, so a failure below is the package, not the network.
if ! npm view @elata-biosciences/eeg-web version >/dev/null 2>&1; then echo "self-check failed: npm cannot reach the registry"; exit 2; fi
echo "self-check ok: registry reachable; node $(node -v), npm $(npm -v)"
echo "eeg-web-ble 0.12.0 asks for: $(npm view @elata-biosciences/eeg-web-ble@0.12.0 peerDependencies --json | tr -d '\n ')"
echo "published eeg-web versions: $(npm view @elata-biosciences/eeg-web versions --json | tr -d '\n ')"
for pkgs in "@elata-biosciences/eeg-web @elata-biosciences/eeg-web-ble" "@elata-biosciences/eeg-web-ble" "@elata-biosciences/ppg-web"; do
  D="$(mktemp -d)"; ( cd "$D" && echo '{"name":"repro","version":"1.0.0","private":true}' > package.json
    npm install --no-audit --no-fund $pkgs > log 2>&1; c=$?
    echo "npm install $pkgs: exit $c $(grep -m1 -o 'code E[A-Z]*' log)" ); rm -rf "$D"
done
