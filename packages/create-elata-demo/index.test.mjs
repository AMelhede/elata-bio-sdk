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
const eegWebVersion = JSON.parse(
  readFileSync(join(__dirname, '..', 'eeg-web', 'package.json'), 'utf8'),
).version;
const eegWebBleVersion = JSON.parse(
  readFileSync(join(__dirname, '..', 'eeg-web-ble', 'package.json'), 'utf8'),
).version;
const rppgWebVersion = JSON.parse(
  readFileSync(join(__dirname, '..', 'rppg-web', 'package.json'), 'utf8'),
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

    const result = spawnSync(process.execPath, [join(packagedDir, 'index.mjs'), 'demo-app'], {
      cwd: tmp,
      encoding: 'utf8',
      timeout: 10_000,
    });

    assert.strictEqual(result.status, 0, `CLI failed:\n${result.stderr}`);
    const pkg = readFileSync(join(tmp, 'demo-app', 'package.json'), 'utf8');
    assert.match(pkg, new RegExp(`"@elata-biosciences/rppg-web": "${rppgWebVersion}"`));
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
