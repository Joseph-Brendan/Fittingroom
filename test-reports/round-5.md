# Round 5: Install like a stranger

## Result

BLOCKED. The tarball packs correctly, but it cannot be installed outside the workspace because the CLI package still depends on unpublished workspace packages.

## What I tested

1. `npm pack` in `packages/cli`. PASS. The tarball was `fittingroom-cli-0.0.0.tgz`. It had 4 files and was 28.1 kB. The unpacked size was 124.3 kB.
2. Create `/Users/josephbrendan/Documents/fr-stranger-test`. PASS.
3. `npm install` the tarball in the empty folder. FAIL. npm exited with `EUNSUPPORTEDPROTOCOL` and `Unsupported URL Type "workspace:": workspace:*`.
4. `npx fitroom --help` from the stranger folder. FAIL because the install failed.
5. Audit bad-ui with the stranger copy. FAIL because the install failed.
6. Start the MCP server from the stranger install. FAIL because the install failed.
7. `npm pack --dry-run` contents. PASS. The package contains `dist/index.d.ts`, `dist/index.js`, `dist/index.js.map` and `package.json`. It contains no fixtures, tests, test reports, `.env` files or private paths. The source map uses relative source names.
8. Delete the stranger folder and the `.tgz` file. PASS.

## Failure found

### Failure 1: The packed CLI cannot be installed with npm

Symptom:

```text
npm error code EUNSUPPORTEDPROTOCOL
npm error Unsupported URL Type "workspace:": workspace:*
```

Root cause: `packages/cli/package.json` lists `@fittingroom/board`, `@fittingroom/citations`, `@fittingroom/core` and `@fittingroom/directions` with `workspace:*`. `npm pack` does not rewrite the workspace protocol. Outside the workspace, npm cannot resolve it. The internal packages are also not published to npm, so even a rewritten version cannot be fetched.

Why I did not fix it: This needs publishing or a bundling decision. `pnpm pack` rewrites `workspace:*` to versions, but the packages are not on npm. The CLI also needs the board package at runtime for the board server, so a simple dependency removal is not safe.

No test was added because the failure is in packaging and publishing, not in a unit of code. The command fails before any Fitting Room code runs.

Files changed: none for this failure.

Proof of the rest of the package: `test-reports/logs/round-5/`.

## Evidence

Pack:

```text
npm notice Tarball Contents
npm notice 20B dist/index.d.ts
npm notice 42.4kB dist/index.js
npm notice 81.1kB dist/index.js.map
npm notice 818B package.json
npm notice Tarball Details
npm notice filename: fittingroom-cli-0.0.0.tgz
npm notice package size: 28.1 kB
npm notice unpacked size: 124.3 kB
npm notice total files: 4
```

Install:

```text
npm error code EUNSUPPORTEDPROTOCOL
npm error Unsupported URL Type "workspace:": workspace:*
```

The source map has relative sources, not private absolute paths. The package has no fixtures, tests, test reports or `.env` files.

Cleanup was done. `/Users/josephbrendan/Documents/fr-stranger-test` and `packages/cli/fittingroom-cli-0.0.0.tgz` are deleted.

## Needs Joseph

- Publish `@fittingroom/core`, `@fittingroom/citations`, `@fittingroom/directions` and `@fittingroom/board` to npm, or approve a bundling strategy for the CLI.
- After publishing, rerun Round 5. The expected command is `pnpm pack` or `npm pack` followed by `npm install` in an empty folder.
