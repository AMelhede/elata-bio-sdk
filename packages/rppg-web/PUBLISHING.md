# Publishing the test package

This branch (`release/test-0`) publishes `@amelhede/rppg-web` to npm under the `test` tag only.
The built files (`dist/` and the WASM in `pkg/`) are committed, so publishing needs only Node
and npm: no Rust, no TypeScript build.

Checked against the npm CLI docs for `npm stage` (docs.npmjs.com/cli/v11/commands/npm-stage,
2026-10-06): staged publishing needs npm 11.15.0 or newer and two-factor authentication turned
on for the npm account; `--tag` and `--access` work as for `npm publish`; a pre-release version
such as `0.15.0-test.0` must be given a tag explicitly, or npm refuses. Node 22 ships npm 10, so
the commands below run npm 11 through `npx` instead of changing the installed npm.

## Commands (Windows PowerShell, from a fresh window)

```powershell
cd C:\Users\andre; if (-not (Test-Path elata-bio-sdk-test)) { git clone https://github.com/AMelhede/elata-bio-sdk.git elata-bio-sdk-test }; cd elata-bio-sdk-test; git fetch origin; git checkout -B release/test-0 origin/release/test-0; cd packages\rppg-web; npx -y npm@11 login; npx -y npm@11 stage publish --tag test --access public
```

1. `npm login` opens the browser to sign in as `amelhede`.
2. `npm stage publish --tag test --access public` first runs `scripts/check-test-release.mjs`
   (the built files are present, the version matches, the WASM has the switch, Elata's MIT
   LICENSE is in the package unedited, nothing that ships names a test dataset or a local path,
   and the tag is not `latest`), then uploads the
   package to npm's staging area. Nothing is public yet. (For a package name that does not exist
   yet, npm creates a public placeholder for the name; the version itself stays hidden until
   approved.)
3. Approve it with two-factor authentication at
   https://www.npmjs.com/settings/amelhede/staged-packages
   (or in the terminal: `npx -y npm@11 stage list`, then `npx -y npm@11 stage approve <id>`).

After approval, `npm view @amelhede/rppg-web dist-tags` shows `test: 0.15.0-test.0`. The
registry may also point `latest` at it, because a brand-new package has no other version; that
changes nothing for the apps, which pin the exact version through the alias below.

## Using it in an app

One line in the app's `package.json`, so every import keeps the official name:

```json
"@elata-biosciences/rppg-web": "npm:@amelhede/rppg-web@0.15.0-test.0"
```

## Rules for every later test build

- Never the `latest` tag. `publishConfig.tag` is `test`, `prepublishOnly` refuses `latest`,
  and the repo-wide publish scripts are disabled on this branch.
- Every build gets its own version (`0.15.0-test.1`, `-test.2`, ...): change `version` in
  `package.json` and `RPPG_WEB_BUILD_VERSION` in `src/buildInfo.ts` together (a unit test
  checks they match), rebuild `pkg/` (WASM) and `dist/`, commit both, then publish as above.
- A published version can be unpublished only within 72 hours, and a version number can never
  be reused, so a mistake costs a new number, not a rewrite.
