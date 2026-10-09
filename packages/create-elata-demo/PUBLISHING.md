# Publishing the starter maker's test build

This branch (`release/test-1`) publishes `@amelhede/create-elata-demo` to npm under the `test` tag only. Publish it
AFTER the rppg-web test build it installs (`elataSdkVersions.rppgWeb` in package.json) is approved on npm: its release
check refuses to publish a starter maker whose starters could not install.

Staged publishing needs npm 11.15.0 or newer and two-factor authentication (the same as for rppg-web, see
`packages/rppg-web/PUBLISHING.md`), so the command runs npm 11 through `npx`.

## Command (Windows PowerShell, from a fresh window)

```powershell
cd C:\Users\andre; if (-not (Test-Path elata-bio-sdk-test)) { git clone https://github.com/AMelhede/elata-bio-sdk.git elata-bio-sdk-test }; cd elata-bio-sdk-test; git fetch origin; git checkout -B release/test-1 origin/release/test-1; cd packages\create-elata-demo; node -p "require('./package.json').version"; npx -y npm@11 login; npx -y npm@11 stage publish --tag test --access public
```

1. `node -p ...` prints the version about to be published: check it is the build meant.
2. `npm stage publish` first runs `scripts/check-test-release.mjs --publish`: the name and `-test.N` version, the `test`
   tag, Elata's MIT LICENSE unedited, every template present, and every package version a starter installs found on
   npm. Then it uploads to npm's staging area; nothing is public yet.
3. Approve it with two-factor authentication at https://www.npmjs.com/settings/amelhede/staged-packages.

## Using it

```text
npx @amelhede/create-elata-demo@test my-app --template rppg-demo
cd my-app
npm install
npm run dev
```
