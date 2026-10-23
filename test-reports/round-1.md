# Round 1: Clean install and automated checks

## Result

PASS

## What I tested

1. Node version. PASS. `node -v` printed `v24.22.1`.
2. Clean install. PASS. Removed `node_modules`, `packages/*/node_modules` and `packages/*/dist`. Ran `pnpm install`.
3. Playwright Chromium. PASS. Ran `pnpm exec playwright install chromium`.
4. Build. PASS. Ran `pnpm build`.
5. Lint. PASS. Ran `pnpm lint`. Checked 259 files.
6. Typecheck. PASS. Ran `pnpm typecheck`.
7. Unit tests. PASS. Ran `pnpm test`. 134 tests in 26 test files passed.
8. Browser tests. PASS. Ran `pnpm test:e2e`. 12 tests passed.

## Failures found

None.

## Evidence

Node and pnpm:

```text
v24.22.1
10.6.1
```

Clean install:

```text
Scope: all 9 workspace projects
Lockfile is up to date, resolution step is skipped
Packages: +408
Done in 3.1s using pnpm v10.6.1
```

Build:

```text
packages/cli build: DTS Build success in 905ms
packages/mcp build: DTS Build success in 1611ms
```

Lint:

```text
Checked 259 files in 49ms. No fixes applied.
```

Typecheck:

```text
packages/cli typecheck: Done
packages/mcp typecheck: Done
```

Unit tests:

```text
citations: 11 passed
board: 3 passed
directions: 5 passed
core: 69 passed
mcp: 19 passed
cli: 27 passed
Total: 134 passed
```

Browser tests:

```text
12 passed (5.9s)
```

Full logs are in `test-reports/logs/round-1/`.

Screenshots: none in this round because Round 1 is automated checks only.

## Needs Joseph

None.
