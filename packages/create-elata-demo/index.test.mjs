import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, 'index.mjs');
const scaffolderPackage = JSON.parse(
  readFileSync(join(__dirname, 'package.json'), 'utf8'),
);
const eegWebVersion = JSON.parse(
  readFileSync(join(__dirname, '..', 'eeg-web', 'package.json'), 'utf8'),
).version;
const eegWebBleVersion = JSON.parse(
  readFileSync(join(__dirname, '..', 'eeg-web-ble', 'package.json'), 'utf8'),
).version;
const rppgWebVersion = JSON.parse(
  readFileSync(join(__dirname, '..', 'rppg-web', 'package.json'), 'utf8'),
).version;
const appMetricsVersion = JSON.parse(
  readFileSync(join(__dirname, '..', 'app-metrics', 'package.json'), 'utf8'),
).version;
const ppgWebVersion = JSON.parse(
  readFileSync(join(__dirname, '..', 'ppg-web', 'package.json'), 'utf8'),
).version;

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 10_000,
  });
}

function runCommand(cmd, args, cwd, timeoutMs = 5 * 60_000) {
  const resolved =
    cmd === 'pnpm'
      ? process.platform === 'win32'
        ? { cmd: 'cmd.exe', args: ['/d', '/s', '/c', ['corepack', 'pnpm', ...args].join(' ')] }
        : { cmd: 'corepack', args: ['pnpm', ...args] }
      : { cmd, args };

  const result = spawnSync(resolved.cmd, resolved.args, {
    cwd,
    stdio: 'inherit',
    timeout: timeoutMs,
  });

  if (result.error) {
    throw result.error;
  }

  assert.strictEqual(
    result.status,
    0,
    `Command failed: ${resolved.cmd} ${resolved.args.join(' ')}`,
  );
}

// What npm installs: package.json plus the entries in its "files", with no SDK package beside it.
function copyPackedFiles(fromDir, toDir) {
  const manifest = JSON.parse(readFileSync(join(fromDir, 'package.json'), 'utf8'));
  mkdirSync(toDir, { recursive: true });
  for (const entry of ['package.json', ...manifest.files]) {
    if (existsSync(join(fromDir, entry))) {
      cpSync(join(fromDir, entry), join(toDir, entry), { recursive: true });
    }
  }
}

function* filesUnder(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      yield* filesUnder(path);
    } else {
      yield path;
    }
  }
}

// The repo package an elataSdkVersions key names (eegWebBle: packages/eeg-web-ble).
function packageDirFor(key) {
  return key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function readManifest(root, dir) {
  return JSON.parse(readFileSync(join(root, 'packages', dir, 'package.json'), 'utf8'));
}

const repoRoot = join(__dirname, '..', '..');
const needsBash = {
  skip: spawnSync('bash', ['--version']).status === 0 ? false : 'needs bash for scripts/run-lib.sh',
};

// Runs scripts/run-lib.sh the way ./run.sh does, with pnpm and npm stubbed out so nothing is
// installed or published.
function runReleaseLib(root, commands) {
  return spawnSync(
    'bash',
    [
      '-c',
      `set -Eeuo pipefail; source scripts/run-lib.sh >/dev/null; pnpm() { :; }; npm() { :; }; ${commands}`,
    ],
    { cwd: root, encoding: 'utf8' },
  );
}

// A scratch copy of what the release reads: scripts/run-lib.sh, create-elata-demo's manifest
// (plus `extraVersions` in its elataSdkVersions), and every package it pins, each one minor
// version on, as at the next release.
function makeReleaseRepo(extraVersions = {}) {
  const root = mkdtempSync(join(tmpdir(), 'create-elata-demo-release-'));
  mkdirSync(join(root, 'scripts'));
  cpSync(join(repoRoot, 'scripts', 'run-lib.sh'), join(root, 'scripts', 'run-lib.sh'));
  // Tarball contents are not under test here.
  writeFileSync(join(root, 'scripts', 'validate-tarballs.mjs'), '');
  const write = (dir, manifest) => {
    mkdirSync(join(root, 'packages', dir), { recursive: true });
    writeFileSync(join(root, 'packages', dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  };
  const scaffolder = structuredClone(scaffolderPackage);
  Object.assign(scaffolder.elataSdkVersions, extraVersions);
  write('create-elata-demo', scaffolder);
  for (const key of Object.keys(scaffolderPackage.elataSdkVersions)) {
    const pkg = readManifest(repoRoot, packageDirFor(key));
    const [major, minor] = pkg.version.split('.').map(Number);
    pkg.version = `${major}.${minor + 1}.0`;
    write(packageDirFor(key), pkg);
  }
  return root;
}

test('lists templates', () => {
  const result = runCli(['--list-templates'], __dirname);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    new RegExp(`create-elata-demo v${scaffolderPackage.version}`),
  );
  assert.match(result.stdout, /rppg-demo/);
  assert.match(result.stdout, /aliases: rppg/);
  assert.match(result.stdout, /eeg-demo/);
  assert.match(result.stdout, /eeg-ble/);
  assert.match(result.stdout, /aliases: ble, eeg-web-ble-demo/);
  assert.match(result.stdout, /ppg-demo/);
  assert.match(result.stdout, /aliases: ppg, muse-ppg/);
  assert.doesNotMatch(result.stdout, /eeg-web-demo/);
});

test('ships fallback SDK versions that match the repo package versions', () => {
  assert.equal(scaffolderPackage.elataSdkVersions.eegWeb, eegWebVersion);
  assert.equal(scaffolderPackage.elataSdkVersions.eegWebBle, eegWebBleVersion);
  assert.equal(scaffolderPackage.elataSdkVersions.rppgWeb, rppgWebVersion);
  assert.equal(scaffolderPackage.elataSdkVersions.ppgWeb, ppgWebVersion);
  assert.equal(scaffolderPackage.elataSdkVersions.appMetrics, appMetricsVersion);
});

test('the release sync keeps every packaged SDK version current', needsBash, () => {
  // Just before it publishes create-elata-demo, the release syncs elataSdkVersions with the
  // repo's packages. A key the sync does not follow goes stale at the next release.
  const root = makeReleaseRepo();
  try {
    const run = runReleaseLib(root, 'sync_create_elata_demo_versions_if_needed');
    assert.equal(run.status, 0, run.stderr);
    const synced = readManifest(root, 'create-elata-demo').elataSdkVersions;
    assert.deepEqual(Object.keys(synced), Object.keys(scaffolderPackage.elataSdkVersions));
    for (const [key, version] of Object.entries(synced)) {
      const current = readManifest(root, packageDirFor(key)).version;
      assert.equal(version, current, `elataSdkVersions.${key} was not synced`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the release publishes create-elata-demo after every package it pins', needsBash, () => {
  // The publish loop patch-bumps an unchanged package at its own turn, so a package published
  // after create-elata-demo moves past the version just synced into it.
  const run = runReleaseLib(repoRoot, 'release_targets_for all');
  assert.equal(run.status, 0, run.stderr);
  const order = run.stdout.trim().split(/\s+/);
  const scaffolderTurn = order.indexOf('create-elata-demo');
  assert.notEqual(scaffolderTurn, -1, order.join(' '));
  for (const key of Object.keys(scaffolderPackage.elataSdkVersions)) {
    const turn = order.indexOf(packageDirFor(key));
    assert.ok(
      turn !== -1 && turn < scaffolderTurn,
      `${packageDirFor(key)} is not released before create-elata-demo: ${order.join(' ')}`,
    );
  }
});

test('release-check refuses a packaged SDK version that names no package', needsBash, () => {
  // create-elata-demo is published last, so a bad entry that only the sync noticed would stop
  // the release after every other package was already published.
  const good = makeReleaseRepo();
  const bad = makeReleaseRepo({ museProto: '1.0.0' });
  try {
    const manifest = join(good, 'packages', 'create-elata-demo', 'package.json');
    const before = readFileSync(manifest, 'utf8');
    const passed = runReleaseLib(good, 'verify_release_contract_for_target all');
    assert.equal(passed.status, 0, passed.stderr);
    assert.equal(readFileSync(manifest, 'utf8'), before, 'release-check must not change files');

    const refused = runReleaseLib(bad, 'verify_release_contract_for_target all');
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /elataSdkVersions\.museProto names no package/);
  } finally {
    rmSync(good, { recursive: true, force: true });
    rmSync(bad, { recursive: true, force: true });
  }
});

test('scaffolds the default template', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'create-elata-demo-'));
  try {
    const result = runCli(['demo-app'], tmp);
    assert.strictEqual(result.status, 0, `CLI failed:\n${result.stderr}`);
    assert.ok(existsSync(join(tmp, 'demo-app', 'package.json')));
    assert.ok(existsSync(join(tmp, 'demo-app', 'README.md')));
    assert.ok(existsSync(join(tmp, 'demo-app', 'src', 'App.tsx')));
    assert.ok(existsSync(join(tmp, 'demo-app', 'src', 'vite-env.d.ts')));
    const pkg = readFileSync(join(tmp, 'demo-app', 'package.json'), 'utf8');
    const app = readFileSync(join(tmp, 'demo-app', 'src', 'App.tsx'), 'utf8');
    const viteEnv = readFileSync(join(tmp, 'demo-app', 'src', 'vite-env.d.ts'), 'utf8');
    assert.match(pkg, new RegExp(`"@elata-biosciences/rppg-web": "${rppgWebVersion}"`));
    assert.match(app, /createRppgSession/);
    assert.match(app, /Technical diagnostics/);
    assert.match(app, /backendMode/);
    assert.match(app, /lastError/);
    assert.match(app, /processorIssues/);
    assert.match(app, /rppg_wasm\.js\?url/);
    assert.match(app, /rppg_wasm_bg\.wasm\?url/);
    assert.match(app, /wasmJsUrl: rppgWasmJsUrl/);
    assert.match(app, /wasmBinaryUrl: rppgWasmBinaryUrl/);
    assert.match(viteEnv, /declare module '\*\.js\?url'/);
    assert.match(viteEnv, /declare module '\*\.wasm\?url'/);
    assert.doesNotMatch(pkg, /postinstall/);
    assert.doesNotMatch(app, /from '\/pkg\/rppg_wasm\.js'/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('scaffolds every template from packaged contents without monorepo siblings', () => {
  // npm installs create-elata-demo with no SDK package beside it, so every version a template
  // needs has to come from the packaged elataSdkVersions. 0.3.1 to 0.12.1 crashed here on start.
  const tmp = mkdtempSync(join(tmpdir(), 'create-elata-demo-packaged-'));
  try {
    const packagedDir = join(tmp, 'pkg');
    copyPackedFiles(__dirname, packagedDir);
    const templateNames = readdirSync(join(packagedDir, 'templates'));
    assert.ok(templateNames.length > 0);

    for (const templateName of templateNames) {
      const appName = `demo-${templateName}`;
      const result = spawnSync(
        process.execPath,
        [join(packagedDir, 'index.mjs'), appName, '--template', templateName],
        { cwd: tmp, encoding: 'utf8', timeout: 10_000 },
      );
      assert.strictEqual(result.status, 0, `CLI failed for ${templateName}:\n${result.stderr}`);

      for (const file of filesUnder(join(tmp, appName))) {
        const left = readFileSync(file, 'utf8').match(/__[A-Z][A-Z0-9_]*__/);
        assert.equal(left, null, `${templateName}: ${left} left in ${file}`);
      }
      const pkg = JSON.parse(readFileSync(join(tmp, appName, 'package.json'), 'utf8'));
      for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
        if (name.startsWith('@elata-biosciences/')) {
          const dir = name.slice('@elata-biosciences/'.length);
          assert.equal(version, readManifest(repoRoot, dir).version, `${templateName}: ${name}`);
        }
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('the publish check refuses a package that cannot scaffold from its packed files', () => {
  // verify:publish runs this check in release-check and in prepack. Before it, the only publish
  // check was that a few files exist, so 0.3.1 to 0.12.1 shipped a CLI that crashed on start.
  const check = (dir) =>
    spawnSync(process.execPath, [join(__dirname, 'scripts', 'verify-packed-cli.mjs'), dir], {
      encoding: 'utf8',
      timeout: 60_000,
    });
  const passed = check(__dirname);
  assert.strictEqual(passed.status, 0, passed.stderr);

  const tmp = mkdtempSync(join(tmpdir(), 'create-elata-demo-publish-check-'));
  try {
    // As 0.3.1 to 0.12.1 shipped: no appMetrics fallback.
    const noFallback = join(tmp, 'no-fallback');
    copyPackedFiles(__dirname, noFallback);
    const manifest = {
      ...scaffolderPackage,
      elataSdkVersions: Object.fromEntries(
        Object.entries(scaffolderPackage.elataSdkVersions).filter(([key]) => key !== 'appMetrics'),
      ),
    };
    writeFileSync(join(noFallback, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    const crashed = check(noFallback);
    assert.notStrictEqual(crashed.status, 0);
    assert.match(crashed.stderr, /Missing packaged SDK version metadata for @elata-biosciences\/app-metrics/);

    // A template that needs a version the CLI does not fill in.
    const unfilled = join(tmp, 'unfilled');
    copyPackedFiles(__dirname, unfilled);
    const templateManifest = join(unfilled, 'templates', 'pulse-game', 'package.json');
    const template = JSON.parse(readFileSync(templateManifest, 'utf8'));
    template.dependencies['@elata-biosciences/biosignal-session'] = '__BIOSIGNAL_SESSION_VERSION__';
    writeFileSync(templateManifest, `${JSON.stringify(template, null, 2)}\n`);
    const leftOver = check(unfilled);
    assert.notStrictEqual(leftOver.status, 0);
    assert.match(leftOver.stderr, /pulse-game: __BIOSIGNAL_SESSION_VERSION__/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('smoke: each published template scaffolds, installs, and builds', () => {
  const templates = ['rppg-demo', 'eeg-demo', 'eeg-ble'];

  for (const templateName of templates) {
    const tmp = mkdtempSync(join(tmpdir(), 'create-elata-demo-smoke-'));
    const appName = `demo-${templateName}`;
    const appDir = join(tmp, appName);

    try {
      const result = runCli([appName, '--template', templateName], tmp);
      assert.strictEqual(
        result.status,
        0,
        `CLI failed for ${templateName}:\n${result.stderr}`,
      );
      assert.ok(existsSync(join(appDir, 'package.json')));
      assert.ok(existsSync(join(appDir, 'README.md')));

      runCommand('pnpm', ['install'], appDir);
      runCommand('pnpm', ['run', 'build'], appDir);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
});

test('scaffolds a selected EEG template', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'create-elata-demo-'));
  try {
    const result = runCli(['brain-demo', '--template', 'eeg-demo'], tmp);
    assert.strictEqual(result.status, 0, `CLI failed:\n${result.stderr}`);
    const pkg = readFileSync(join(tmp, 'brain-demo', 'package.json'), 'utf8');
    assert.match(pkg, new RegExp(`"@elata-biosciences/eeg-web-ble": "${eegWebBleVersion}"`));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('scaffolds the BLE template with current package versions', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'create-elata-demo-'));
  try {
    const result = runCli(['ble-demo', '--template', 'eeg-ble'], tmp);
    assert.strictEqual(result.status, 0, `CLI failed:\n${result.stderr}`);
    const pkg = readFileSync(join(tmp, 'ble-demo', 'package.json'), 'utf8');
    assert.match(pkg, new RegExp(`"@elata-biosciences/eeg-web": "${eegWebVersion}"`));
    assert.match(
      pkg,
      new RegExp(`"@elata-biosciences/eeg-web-ble": "${eegWebBleVersion}"`),
    );
    const readme = readFileSync(join(tmp, 'ble-demo', 'README.md'), 'utf8');
    assert.match(readme, /eeg-ble/);
    assert.match(readme, /ios-demo\/EegDemoApp\/Bluetooth\/MuseBluetoothManager\.swift/);
    assert.match(readme, /android-demo\/app\/src\/main\/AndroidManifest\.xml/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('scaffolds the PPG template with current package versions', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'create-elata-demo-'));
  try {
    const result = runCli(['ppg-starter', '--template', 'ppg-demo'], tmp);
    assert.strictEqual(result.status, 0, `CLI failed:\n${result.stderr}`);
    const pkg = readFileSync(join(tmp, 'ppg-starter', 'package.json'), 'utf8');
    assert.match(pkg, new RegExp(`"@elata-biosciences/ppg-web": "${ppgWebVersion}"`));
    assert.match(pkg, new RegExp(`"@elata-biosciences/eeg-web": "${eegWebVersion}"`));
    assert.match(
      pkg,
      new RegExp(`"@elata-biosciences/eeg-web-ble": "${eegWebBleVersion}"`),
    );
    assert.match(pkg, new RegExp(`"@elata-biosciences/rppg-web": "${rppgWebVersion}"`));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('warns when scaffolding inside a parent pnpm workspace', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'create-elata-demo-workspace-'));
  try {
    const workspaceDir = join(tmp, 'workspace');
    mkdirSync(workspaceDir);
    writeFileSync(join(workspaceDir, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');

    const result = runCli(['nested-demo'], workspaceDir);
    assert.strictEqual(result.status, 0, `CLI failed:\n${result.stderr}`);
    assert.match(result.stdout, /inside an existing pnpm workspace/);
    assert.match(result.stdout, /--ignore-workspace install/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('accepts a short template alias', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'create-elata-demo-'));
  try {
    const result = runCli(['brain-demo', '--template', 'eeg'], tmp);
    assert.strictEqual(result.status, 0, `CLI failed:\n${result.stderr}`);
    const pkg = readFileSync(join(tmp, 'brain-demo', 'package.json'), 'utf8');
    assert.match(pkg, new RegExp(`"@elata-biosciences/eeg-web-ble": "${eegWebBleVersion}"`));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('accepts the BLE short alias', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'create-elata-demo-'));
  try {
    const result = runCli(['ble-short-demo', '--template', 'ble'], tmp);
    assert.strictEqual(result.status, 0, `CLI failed:\n${result.stderr}`);
    const readme = readFileSync(join(tmp, 'ble-short-demo', 'README.md'), 'utf8');
    assert.match(readme, /eeg-ble/);
    const app = readFileSync(join(tmp, 'ble-short-demo', 'src', 'App.tsx'), 'utf8');
    assert.match(app, /iOS native BLE reference/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('accepts the PPG short alias', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'create-elata-demo-'));
  try {
    const result = runCli(['pulse-demo', '--template', 'ppg'], tmp);
    assert.strictEqual(result.status, 0, `CLI failed:\n${result.stderr}`);
    const readme = readFileSync(join(tmp, 'pulse-demo', 'README.md'), 'utf8');
    assert.match(readme, /Muse PPG/);
    const app = readFileSync(join(tmp, 'pulse-demo', 'src', 'App.tsx'), 'utf8');
    assert.match(app, /createMusePpgSession/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('ppg-demo vite config excludes SDK packages from dep optimization', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'create-elata-demo-'));
  try {
    const result = runCli(['pulse-demo', '--template', 'ppg-demo'], tmp);
    assert.strictEqual(result.status, 0, result.stderr);
    const viteConfig = readFileSync(join(tmp, 'pulse-demo', 'vite.config.ts'), 'utf8');
    assert.match(viteConfig, /optimizeDeps/);
    assert.match(viteConfig, /@elata-biosciences\/ppg-web/);
    assert.match(viteConfig, /@elata-biosciences\/eeg-web/);
    assert.match(viteConfig, /@elata-biosciences\/eeg-web-ble/);
    assert.match(viteConfig, /@elata-biosciences\/rppg-web/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('rppg-demo vite config excludes package from dep optimization', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'create-elata-demo-'));
  try {
    const result = runCli(['my-demo', '--template', 'rppg-demo'], tmp);
    assert.strictEqual(result.status, 0, result.stderr);
    const viteConfig = readFileSync(join(tmp, 'my-demo', 'vite.config.ts'), 'utf8');
    assert.match(viteConfig, /optimizeDeps/);
    assert.match(viteConfig, /@elata-biosciences\/rppg-web/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('eeg-demo vite config excludes packages from dep optimization', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'create-elata-demo-'));
  try {
    const result = runCli(['my-demo', '--template', 'eeg-demo'], tmp);
    assert.strictEqual(result.status, 0, result.stderr);
    const viteConfig = readFileSync(join(tmp, 'my-demo', 'vite.config.ts'), 'utf8');
    assert.match(viteConfig, /optimizeDeps/);
    assert.match(viteConfig, /@elata-biosciences\/eeg-web[^-]/);
    assert.match(viteConfig, /@elata-biosciences\/eeg-web-ble/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('rppg template uses Vite URL assets instead of public pkg imports', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'create-elata-demo-'));
  try {
    const result = runCli(['pulse-demo', '--template', 'rppg-web-demo'], tmp);
    assert.strictEqual(result.status, 0, `CLI failed:\n${result.stderr}`);

    const appDir = join(tmp, 'pulse-demo');
    const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));
    const app = readFileSync(join(appDir, 'src', 'App.tsx'), 'utf8');
    const viteEnv = readFileSync(join(appDir, 'src', 'vite-env.d.ts'), 'utf8');

    assert.equal(pkg.scripts.postinstall, undefined);
    assert.ok(!existsSync(join(appDir, 'sync-rppg-wasm-assets.mjs')));
    assert.match(app, /@elata-biosciences\/rppg-web\/pkg\/rppg_wasm\.js\?url/);
    assert.match(app, /@elata-biosciences\/rppg-web\/pkg\/rppg_wasm_bg\.wasm\?url/);
    assert.match(app, /wasmJsUrl: rppgWasmJsUrl/);
    assert.match(app, /wasmBinaryUrl: rppgWasmBinaryUrl/);
    assert.match(viteEnv, /reference types="vite\/client"/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('fails on unknown template', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'create-elata-demo-'));
  try {
    const result = runCli(['bad-demo', '--template', 'missing-template'], tmp);
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /unknown template/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
