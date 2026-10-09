import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
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
/**
 * The dependency spec a generated app gets for a sibling package: its version, or, when the sibling
 * is published under another name (a fork's test build), an npm alias to it under the expected name.
 */
function siblingSpec(dir, expectedName) {
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', dir, 'package.json'), 'utf8'));
  return pkg.name === expectedName ? pkg.version : `npm:${pkg.name}@${pkg.version}`;
}
const eegWebVersion = siblingSpec('eeg-web', '@elata-biosciences/eeg-web');
const eegWebBleVersion = siblingSpec('eeg-web-ble', '@elata-biosciences/eeg-web-ble');
const rppgWebVersion = siblingSpec('rppg-web', '@elata-biosciences/rppg-web');
const ppgWebVersion = siblingSpec('ppg-web', '@elata-biosciences/ppg-web');
const appMetricsVersion = siblingSpec('app-metrics', '@elata-biosciences/app-metrics');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let packedRppgWeb = null;
/** The sibling rppg-web as npm would publish it (npm pack), made once per run. */
function localRppgWebTarball() {
  if (packedRppgWeb) return packedRppgWeb;
  const out = mkdtempSync(join(tmpdir(), 'create-elata-demo-pack-'));
  const r = spawnSync('npm', ['pack', '--silent', '--pack-destination', out], {
    cwd: join(__dirname, '..', 'rppg-web'),
    encoding: 'utf8',
    timeout: 120_000,
  });
  assert.strictEqual(r.status, 0, `npm pack failed:\n${r.stderr}`);
  packedRppgWeb = join(out, r.stdout.trim().split('\n').pop());
  return packedRppgWeb;
}

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
  // 0.12.1 shipped without this one, and every template crashed at start for everyone.
  assert.equal(scaffolderPackage.elataSdkVersions.appMetrics, appMetricsVersion);
});

test('every version the CLI reads has a packaged fallback', () => {
  const src = readFileSync(CLI, 'utf8');
  const keys = [...src.matchAll(/packageMetadata\.elataSdkVersions\?\.(\w+)/g)].map((m) => m[1]);
  assert.ok(keys.length >= 5, `found ${keys.length} version reads`);
  for (const key of keys)
    assert.ok(scaffolderPackage.elataSdkVersions[key], `elataSdkVersions.${key} is missing`);
});

test('a sibling published under another name is installed through an npm alias', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'create-elata-demo-alias-'));
  try {
    const packagedDir = join(tmp, 'gen', 'create-elata-demo');
    mkdirSync(packagedDir, { recursive: true });
    cpSync(join(__dirname, 'index.mjs'), join(packagedDir, 'index.mjs'));
    cpSync(join(__dirname, 'package.json'), join(packagedDir, 'package.json'));
    cpSync(join(__dirname, 'templates'), join(packagedDir, 'templates'), { recursive: true });
    mkdirSync(join(tmp, 'gen', 'rppg-web'));
    writeFileSync(
      join(tmp, 'gen', 'rppg-web', 'package.json'),
      JSON.stringify({ name: '@someone/rppg-web', version: '9.9.9-test.1' }),
    );
    const result = spawnSync(process.execPath, [join(packagedDir, 'index.mjs'), 'demo-app'], {
      cwd: tmp,
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.strictEqual(result.status, 0, `CLI failed:\n${result.stderr}`);
    const pkg = JSON.parse(readFileSync(join(tmp, 'demo-app', 'package.json'), 'utf8'));
    assert.equal(pkg.dependencies['@elata-biosciences/rppg-web'], 'npm:@someone/rppg-web@9.9.9-test.1');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('no template builds through vite-plugin-top-level-await (its production build fails), all target es2022', () => {
  for (const t of ['rppg-demo', 'ppg-demo', 'eeg-demo', 'eeg-ble', 'pulse-game']) {
    const pkg = readFileSync(join(__dirname, 'templates', t, 'package.json'), 'utf8');
    const vite = readFileSync(join(__dirname, 'templates', t, 'vite.config.ts'), 'utf8');
    assert.doesNotMatch(pkg, /vite-plugin-top-level-await/, t);
    assert.doesNotMatch(vite, /^import .*top-level-await/m, t);
    assert.match(vite, /target: 'es2022'/, t);
  }
});

test("the BLE template's two packages install together: eeg-web-ble's peer range takes eeg-web's version", () => {
  const ble = JSON.parse(readFileSync(join(__dirname, '..', 'eeg-web-ble', 'package.json'), 'utf8'));
  const web = JSON.parse(readFileSync(join(__dirname, '..', 'eeg-web', 'package.json'), 'utf8'));
  const range = ble.peerDependencies['@elata-biosciences/eeg-web'];
  const m = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range);
  assert.ok(m, `unexpected peer range ${range}`);
  const [maj, min] = web.version.split('.').map(Number);
  // A caret range below 1.0 holds one minor version: ^0.2.1 takes 0.2.x only.
  assert.ok(Number(m[1]) === maj && (maj > 0 || Number(m[2]) === min), `${range} does not take ${web.version}`);
});

test('the heart-rate template shows only the checked heart rate, nothing unproven', () => {
  const app = readFileSync(join(__dirname, 'templates', 'rppg-demo', 'src', 'App.tsx'), 'utf8');
  // Mood (face + HRV), breathing and HRV have not passed a check against a reference; the engine's own
  // confidence and signal quality describe the camera picture, not the number shown (signal quality
  // read 100% while the rate was invented), and the tracker no longer moves the checked rate.
  assert.doesNotMatch(app, /AffectTracker|classifyAffectLabel|hrv_rmssd|respiration_rate|enableTracker/);
  assert.doesNotMatch(app, /metrics\.confidence|metrics\.signal_quality|confidencePct|qualityPct/);
  assert.match(app, /session\.getMetrics\(\)/);
  assert.match(app, /Looking for a pulse/);
  // A camera on a wall is told why nothing comes, not to keep waiting.
  assert.match(app, /lastDropReason === 'no_face'/);
  assert.doesNotMatch(app, /'Warm-up'/);
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
    assert.match(pkg, new RegExp(`"@elata-biosciences/rppg-web": "${esc(rppgWebVersion)}"`));
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

test('scaffolds correctly from packaged contents without monorepo siblings', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'create-elata-demo-packaged-'));
  try {
    const packagedDir = join(tmp, 'pkg');
    mkdirSync(packagedDir);
    cpSync(join(__dirname, 'index.mjs'), join(packagedDir, 'index.mjs'));
    cpSync(join(__dirname, 'package.json'), join(packagedDir, 'package.json'));
    cpSync(join(__dirname, 'templates'), join(packagedDir, 'templates'), {
      recursive: true,
    });

    for (const t of ['rppg-demo', 'ppg-demo', 'eeg-demo', 'eeg-ble', 'pulse-game']) {
      const result = spawnSync(process.execPath, [join(packagedDir, 'index.mjs'), `app-${t}`, '--template', t], {
        cwd: tmp,
        encoding: 'utf8',
        timeout: 10_000,
      });
      assert.strictEqual(result.status, 0, `CLI failed for ${t}:\n${result.stderr}`);
      const pkg = readFileSync(join(tmp, `app-${t}`, 'package.json'), 'utf8');
      assert.doesNotMatch(pkg, /__[A-Z_]+_VERSION__/, `${t} has a version left unfilled`);
    }
    const pkg = readFileSync(join(tmp, 'app-rppg-demo', 'package.json'), 'utf8');
    assert.match(pkg, new RegExp(`"@elata-biosciences/rppg-web": "${esc(scaffolderPackage.elataSdkVersions.rppgWeb)}"`));
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

      // A sibling published under another name (a fork's test build) is not on the registry until it
      // is published: install the local build instead, which is what has to work before publishing.
      if (rppgWebVersion.startsWith('npm:')) {
        const pkgPath = join(appDir, 'package.json');
        const app = JSON.parse(readFileSync(pkgPath, 'utf8'));
        if (app.dependencies['@elata-biosciences/rppg-web']) {
          app.dependencies['@elata-biosciences/rppg-web'] = `file:${localRppgWebTarball()}`;
          writeFileSync(pkgPath, JSON.stringify(app, null, 2));
        }
      }
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
    assert.match(pkg, new RegExp(`"@elata-biosciences/eeg-web-ble": "${esc(eegWebBleVersion)}"`));
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
    assert.match(pkg, new RegExp(`"@elata-biosciences/eeg-web": "${esc(eegWebVersion)}"`));
    assert.match(
      pkg,
      new RegExp(`"@elata-biosciences/eeg-web-ble": "${esc(eegWebBleVersion)}"`),
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
    assert.match(pkg, new RegExp(`"@elata-biosciences/ppg-web": "${esc(ppgWebVersion)}"`));
    assert.match(pkg, new RegExp(`"@elata-biosciences/eeg-web": "${esc(eegWebVersion)}"`));
    assert.match(
      pkg,
      new RegExp(`"@elata-biosciences/eeg-web-ble": "${esc(eegWebBleVersion)}"`),
    );
    assert.match(pkg, new RegExp(`"@elata-biosciences/rppg-web": "${esc(rppgWebVersion)}"`));
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
    assert.match(pkg, new RegExp(`"@elata-biosciences/eeg-web-ble": "${esc(eegWebBleVersion)}"`));
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
