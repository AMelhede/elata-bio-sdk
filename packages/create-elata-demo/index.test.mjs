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

// Each template is a directory. A stray file beside them, such as the .DS_Store macOS Finder
// leaves, is not a template, and npm does not pack it.
function templateNamesIn(packageDir) {
  return readdirSync(join(packageDir, 'templates'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
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

const TEMPLATE_DIRS = ['rppg-demo', 'ppg-demo', 'eeg-demo', 'eeg-ble', 'pulse-game'];

test('no template depends on vite-plugin-top-level-await, and each one allows esbuild for pnpm 11+', () => {
  // The behaviour test is the smoke test below (scaffold, install, build). This guard is the cheap
  // part of it that runs offline: the plugin's production build fails with @swc/core >= 1.16.0, and
  // pnpm 11+ refuses to install until esbuild's build script is reviewed in pnpm-workspace.yaml.
  for (const t of TEMPLATE_DIRS) {
    const dir = join(__dirname, 'templates', t);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    assert.ok(!('vite-plugin-top-level-await' in deps), `${t}: depends on vite-plugin-top-level-await`);
    assert.doesNotMatch(readFileSync(join(dir, 'vite.config.ts'), 'utf8'), /top-level-await/, t);
    const ws = readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8').replace(/#.*$/gm, '');
    assert.match(ws, /^packages:\s*(\n\s+- ['"]?\.['"]?\s*$|\[\s*['"]?\.['"]?\s*\])/m, `${t}: packages must list the app`);
    assert.match(ws, /^allowBuilds:\s*(\n\s+esbuild:\s*true|\{\s*esbuild:\s*true\s*\})/m, `${t}: esbuild not allowed`);
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
    const templateNames = templateNamesIn(packagedDir);
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
    // A file beside the templates, such as the .DS_Store macOS Finder leaves (git ignores it and
    // npm does not pack it), is not a template and must not stop a release.
    const strayFile = join(tmp, 'stray-file');
    copyPackedFiles(__dirname, strayFile);
    writeFileSync(join(strayFile, 'templates', '.DS_Store'), '');
    const tolerated = check(strayFile);
    assert.strictEqual(tolerated.status, 0, tolerated.stderr);

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

    // A global that Vite's define replaces at build time (written __NAME__ by convention) lives in
    // module code, where the CLI fills nothing. It is not a placeholder and must not stop a release.
    const defineGlobal = join(tmp, 'define-global');
    copyPackedFiles(__dirname, defineGlobal);
    const gameEntry = join(defineGlobal, 'templates', 'pulse-game', 'src', 'game', 'main.tsx');
    writeFileSync(gameEntry, `${readFileSync(gameEntry, 'utf8')}console.log(__APP_VERSION__);\n`);
    const defined = check(defineGlobal);
    assert.strictEqual(defined.status, 0, defined.stderr);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('verify:publish refuses a package that cannot start from npm', () => {
  // release-check runs verify:publish before anything is published, and prepack runs it again.
  // Run that script line the way npm and pnpm do (in a shell), in a copy laid out like the repo,
  // so the test fails if the publish check is ever dropped from it.
  const tmp = mkdtempSync(join(tmpdir(), 'create-elata-demo-verify-publish-'));
  try {
    mkdirSync(join(tmp, 'scripts'));
    cpSync(
      join(repoRoot, 'scripts', 'verify-package-build.mjs'),
      join(tmp, 'scripts', 'verify-package-build.mjs'),
    );
    const packageDir = join(tmp, 'packages', 'create-elata-demo');
    copyPackedFiles(__dirname, packageDir);
    cpSync(join(__dirname, 'scripts'), join(packageDir, 'scripts'), { recursive: true });
    const verifyPublish = () =>
      spawnSync(scaffolderPackage.scripts['verify:publish'], {
        cwd: packageDir,
        shell: true,
        encoding: 'utf8',
        timeout: 60_000,
      });

    const passed = verifyPublish();
    assert.strictEqual(passed.status, 0, passed.stderr);

    // As 0.3.1 to 0.12.1 shipped: no appMetrics fallback.
    const manifest = {
      ...scaffolderPackage,
      elataSdkVersions: Object.fromEntries(
        Object.entries(scaffolderPackage.elataSdkVersions).filter(([key]) => key !== 'appMetrics'),
      ),
    };
    writeFileSync(join(packageDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    const refused = verifyPublish();
    assert.notStrictEqual(refused.status, 0, 'verify:publish passed a package that crashes on start');
    assert.match(refused.stderr, /Missing packaged SDK version metadata for @elata-biosciences\/app-metrics/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('smoke: each published template scaffolds, installs, and builds', () => {
  // Every template, with pnpm as corepack resolves it today (its version is printed first).
  for (const templateName of TEMPLATE_DIRS) {
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

      runCommand('pnpm', ['--version'], appDir);
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
    assert.match(result.stdout, /pnpm --dir nested-demo install/);
    assert.doesNotMatch(result.stdout, /--ignore-workspace/);
    assert.ok(existsSync(join(workspaceDir, 'nested-demo', 'pnpm-workspace.yaml')));
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

test('./run.sh unlink removes the link overrides pnpm link records, and only those', (t) => {
  // `./run.sh link` runs `pnpm link`, which records the local build as a `link:` override in the
  // app's pnpm-workspace.yaml (creating an override-only file when the app has none), or in
  // package.json's pnpm.overrides when package.json has a "pnpm" field (pnpm 10). Every starter
  // now ships its own pnpm-workspace.yaml, so unlink has to edit that file rather than delete it
  // or leave it. This runs the repo's real `./run.sh unlink` with pnpm stubbed on PATH, so nothing
  // is installed; the stub records that a reinstall was asked for.
  if (spawnSync('bash', ['--version']).status !== 0) {
    t.skip('needs bash');
    return;
  }
  const runSh = join(__dirname, '..', '..', 'run.sh');
  const tmp = mkdtempSync(join(tmpdir(), 'create-elata-demo-unlink-'));
  try {
    const bin = join(tmp, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'pnpm'), '#!/bin/sh\necho "pnpm $*" >> "$PNPM_LOG"\n', { mode: 0o755 });
    const lines = (...rows) => `${rows.join('\n')}\n`;
    const unlink = (name, files) => {
      const app = join(tmp, name);
      mkdirSync(app);
      for (const [file, text] of Object.entries(files)) writeFileSync(join(app, file), text);
      const log = join(tmp, `${name}.pnpm.log`);
      const run = spawnSync('bash', [runSh, 'unlink', app], {
        encoding: 'utf8',
        timeout: 30_000,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, PNPM_LOG: log },
      });
      const read = (file) => (existsSync(join(app, file)) ? readFileSync(join(app, file), 'utf8') : null);
      return { run, read, reinstalled: existsSync(log) };
    };
    const ok = (result) => {
      assert.equal(result.run.status, 0, result.run.stderr);
      assert.ok(result.reinstalled, 'unlink did not reinstall');
    };
    const pkg = '{\n  "name": "app"\n}\n';

    // A starter's own workspace file after `pnpm link`: the link goes, everything else stays.
    const starter = unlink('starter', {
      'package.json': pkg,
      'pnpm-workspace.yaml': lines(
        '# comment', 'packages:', '  - .', 'allowBuilds:', '  esbuild: true', 'overrides:',
        "  '@elata-biosciences/rppg-web': link:../../elata-bio-sdk/packages/rppg-web",
      ),
    });
    ok(starter);
    assert.equal(
      starter.read('pnpm-workspace.yaml'),
      lines('# comment', 'packages:', '  - .', 'allowBuilds:', '  esbuild: true'),
    );

    // Another override in the same block is kept, with its key.
    const mixed = unlink('mixed', {
      'package.json': pkg,
      'pnpm-workspace.yaml': lines(
        'overrides:', '  foo: 1.2.3', "  '@elata-biosciences/eeg-web': link:../eeg-web", 'packages:', '  - .',
      ),
    });
    ok(mixed);
    assert.equal(mixed.read('pnpm-workspace.yaml'), lines('overrides:', '  foo: 1.2.3', 'packages:', '  - .'));

    // The override-only file pnpm creates for an app without a workspace file is removed.
    const only = unlink('only', {
      'package.json': pkg,
      'pnpm-workspace.yaml': lines('overrides:', "  '@elata-biosciences/rppg-web': link:../rppg-web"),
    });
    ok(only);
    assert.equal(only.read('pnpm-workspace.yaml'), null);

    // Blank lines and comments inside the block do not end it. This is the layout pnpm 10.33.2
    // writes when the app's own overrides are separated by a blank line: the link sorts first and
    // the blank line follows it. The other overrides stay under `overrides:`.
    const blank = unlink('blank', {
      'package.json': pkg,
      'pnpm-workspace.yaml': lines(
        'packages:', '  - .', 'allowBuilds:', '  esbuild: true', 'overrides:',
        "  '@elata-biosciences/rppg-web': link:../rppg-web", '', '  react: 18.3.1', '  zod: 3.23.8',
      ),
    });
    ok(blank);
    assert.equal(
      blank.read('pnpm-workspace.yaml'),
      lines('packages:', '  - .', 'allowBuilds:', '  esbuild: true', 'overrides:', '', '  react: 18.3.1', '  zod: 3.23.8'),
    );
    const comment = unlink('comment', {
      'package.json': pkg,
      'pnpm-workspace.yaml': lines(
        'overrides:', '# pinned on purpose', "  '@elata-biosciences/rppg-web': link:../rppg-web", '  zod: 3.23.8',
        'packages:', '  - .',
      ),
    });
    ok(comment);
    assert.equal(
      comment.read('pnpm-workspace.yaml'),
      lines('overrides:', '# pinned on purpose', '  zod: 3.23.8', 'packages:', '  - .'),
    );

    // A comment after the key is still the key.
    const keyComment = unlink('key-comment', {
      'package.json': pkg,
      'pnpm-workspace.yaml': lines(
        'packages:', '  - .', 'overrides: # local builds', "  '@elata-biosciences/rppg-web': link:../rppg-web",
      ),
    });
    ok(keyComment);
    assert.equal(keyComment.read('pnpm-workspace.yaml'), lines('packages:', '  - .'));

    // pnpm 10 writes the link into package.json's pnpm.overrides when package.json has a "pnpm"
    // field. That link goes; the other override, the rest of the field, a dependency the app itself
    // declares as link: and the file's indentation stay.
    const withPnpmField = unlink('pnpm-field', {
      'package.json': lines(
        '{', '  "name": "app",', '  "dependencies": {', '    "local-thing": "link:../local-thing"', '  },',
        '  "pnpm": {', '    "onlyBuiltDependencies": [', '      "esbuild"', '    ],', '    "overrides": {',
        '      "@elata-biosciences/rppg-web": "link:../rppg-web",', '      "zod": "3.23.8"', '    }', '  }', '}',
      ),
    });
    ok(withPnpmField);
    assert.equal(
      withPnpmField.read('package.json'),
      lines(
        '{', '  "name": "app",', '  "dependencies": {', '    "local-thing": "link:../local-thing"', '  },',
        '  "pnpm": {', '    "onlyBuiltDependencies": [', '      "esbuild"', '    ],', '    "overrides": {',
        '      "zod": "3.23.8"', '    }', '  }', '}',
      ),
    );

    // An overrides object, and then a pnpm field, left empty are dropped, like the workspace key.
    const pnpmFieldOnly = unlink('pnpm-field-only', {
      'package.json':
        '{\n\t"name": "app",\n\t"pnpm": {\n\t\t"overrides": {\n\t\t\t"@elata-biosciences/rppg-web": "link:../rppg-web"\n\t\t}\n\t}\n}\n',
    });
    ok(pnpmFieldOnly);
    assert.equal(pnpmFieldOnly.read('package.json'), '{\n\t"name": "app"\n}\n');

    // A link this cannot edit (overrides written inline) fails before reinstalling instead of
    // reporting "Unlinked", and the file is left as it was.
    const inlineFile = lines('packages:', '  - .', "overrides: { '@elata-biosciences/rppg-web': 'link:../rppg-web' }");
    const inline = unlink('inline', { 'package.json': pkg, 'pnpm-workspace.yaml': inlineFile });
    assert.notEqual(inline.run.status, 0, 'unlink reported success with an inline link override left in place');
    assert.match(inline.run.stderr, /link:/);
    assert.doesNotMatch(inline.run.stdout, /Unlinked/);
    assert.equal(inline.reinstalled, false);
    assert.equal(inline.read('pnpm-workspace.yaml'), inlineFile);
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

test('a semver release bump moves the peer ranges that name the bumped packages', () => {
  // `./run.sh release minor` bumps every package in the `all` set with `pnpm version`
  // (bump_publish_packages in scripts/run-lib.sh), which rewrites only each package's own version.
  // Below 1.0 a caret range takes one minor version, so a peer range left behind refuses the new
  // version and `npm install` stops (ERESOLVE) for any app installing eeg-web-ble or ppg-web beside
  // its peers, the eeg-ble, eeg-demo and ppg-demo templates included. This runs the repo's own bump
  // and release commit on a copy of every workspace manifest, one minor release on.
  const repo = join(__dirname, '..', '..');
  const root = mkdtempSync(join(tmpdir(), 'create-elata-demo-peers-'));
  try {
    mkdirSync(join(root, 'scripts'));
    cpSync(join(repo, 'scripts', 'run-lib.sh'), join(root, 'scripts', 'run-lib.sh'));
    const before = new Map();
    for (const dir of readdirSync(join(repo, 'packages'))) {
      const manifest = join(repo, 'packages', dir, 'package.json');
      if (!existsSync(manifest)) continue;
      mkdirSync(join(root, 'packages', dir), { recursive: true });
      cpSync(manifest, join(root, 'packages', dir, 'package.json'));
      const { name, version } = JSON.parse(readFileSync(manifest, 'utf8'));
      before.set(name, version);
    }
    // Stands in for `pnpm version minor`, which rewrites the version of the package it runs in.
    const pnpmVersion = join(root, 'pnpm-version.cjs');
    writeFileSync(
      pnpmVersion,
      [
        "const fs = require('node:fs');",
        "const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));",
        "const [major, minor] = pkg.version.split('.').map(Number);",
        'pkg.version = `${major}.${minor + 1}.0`;',
        "fs.writeFileSync('package.json', `${JSON.stringify(pkg, null, '\\t')}\\n`);",
      ].join('\n'),
    );
    const env = {
      ...process.env,
      PNPM_VERSION_STUB: pnpmVersion,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    };
    const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', env });
    assert.equal(git('init', '-q').status, 0);
    assert.equal(git('add', '-A').status, 0);
    assert.equal(git('commit', '-qm', 'base').status, 0);
    // A package that is not committed yet (a release run with ALLOW_DIRTY=1) is not part of the
    // release, even when it peers on a bumped package.
    mkdirSync(join(root, 'packages', 'zz-uncommitted'));
    writeFileSync(
      join(root, 'packages', 'zz-uncommitted', 'package.json'),
      `${JSON.stringify(
        {
          name: '@elata-biosciences/zz-uncommitted',
          version: '0.0.0',
          peerDependencies: {
            '@elata-biosciences/eeg-web': `^${before.get('@elata-biosciences/eeg-web')}`,
          },
        },
        null,
        '\t',
      )}\n`,
    );
    // Uncommitted edits to committed manifests (also only possible with ALLOW_DIRTY=1) stay out of
    // the release commit too: app-state, which no bump touches, and biosignal-analytics, whose rppg-web
    // peer the release moves. Only the peer range goes into the commit; the edit stays in the tree.
    const localEdit = (dir) => {
      const file = join(root, 'packages', dir, 'package.json');
      const text = readFileSync(file, 'utf8');
      const edited = text.replace(/("description": ")/, '$1local edit, ');
      assert.notEqual(edited, text);
      writeFileSync(file, edited);
    };
    localEdit('app-state');
    localEdit('biosignal-analytics');

    const release = spawnSync(
      'bash',
      [
        '-c',
        [
          'source scripts/run-lib.sh',
          'pnpm() { if [[ "$1" == version && "$2" == minor ]]; then node "$PNPM_VERSION_STUB"; fi; }',
          'git() { if [[ "$1" == push ]]; then return 0; fi; command git "$@"; }',
          'bump_publish_packages minor',
          'release_commit_and_push_version_changes all latest',
        ].join('\n'),
      ],
      { cwd: root, encoding: 'utf8', env },
    );
    assert.equal(release.status, 0, release.stderr);

    const after = new Map();
    for (const dir of readdirSync(join(root, 'packages'))) {
      const manifest = JSON.parse(readFileSync(join(root, 'packages', dir, 'package.json'), 'utf8'));
      after.set(manifest.name, manifest);
    }
    const stale = [];
    let checked = 0;
    for (const manifest of after.values()) {
      for (const [name, range] of Object.entries(manifest.peerDependencies ?? {})) {
        const sibling = after.get(name);
        if (!sibling || sibling.version === before.get(name)) continue;
        checked += 1;
        // ^<new version>, as `changeset version` writes; for a new 0.x minor such as 0.13.0 it is
        // also the only caret range that takes it.
        if (range !== `^${sibling.version}`) {
          stale.push(`${manifest.name}: peer ${name} ${range} does not take the new ${sibling.version}`);
        }
      }
    }
    assert.ok(checked > 0, 'no workspace peer names a bumped package');
    assert.deepEqual(stale, []);
    assert.equal(
      git('status', '--porcelain').stdout,
      [
        ' M packages/app-state/package.json',
        ' M packages/biosignal-analytics/package.json',
        '?? packages/zz-uncommitted/',
        '',
      ].join('\n'),
      'the release commit must take every manifest the release edited, and nothing it did not edit',
    );
    const committed = (dir) => JSON.parse(git('show', `HEAD:packages/${dir}/package.json`).stdout);
    assert.doesNotMatch(committed('app-state').description, /local edit/);
    const analytics = committed('biosignal-analytics');
    assert.doesNotMatch(analytics.description, /local edit/);
    assert.equal(
      analytics.peerDependencies['@elata-biosciences/rppg-web'],
      `^${after.get('@elata-biosciences/rppg-web').version}`,
    );
    assert.match(after.get('@elata-biosciences/biosignal-analytics').description, /^local edit, /);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
