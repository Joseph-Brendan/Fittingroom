# Contributing to Fitting Room

Thanks for helping. Fitting Room is built test first and kept small on purpose.

## Before you start

- Read `AGENTS.md`. It is the source of truth for product and code rules.
- Open an issue for a bug or a feature before a large change. Small fixes can go straight to a pull
  request.
- Keep one feature or fix per pull request.

## Setup

```bash
corepack enable
pnpm install
pnpm test
```

Use Node 24 and pnpm 10.6.1.

## Test first

1. Restate the task in one or two sentences.
2. List the tests you will write.
3. Write the tests and run them. Watch them fail for the right reason.
4. Write the smallest change that makes them pass.
5. Refactor and run the full checks.

No feature code without a failing test before it.

Run the full checks before you ask for review:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

For browser changes, also run `pnpm test:e2e` after installing Chromium.

## Audit rules

- Every finding needs a citation ID from `packages/citations/registry.json`.
- Do not invent an ID or type a URL into a finding.
- Use WCAG 2.2. Do not cite WCAG 3.
- Laws of UX can support a finding, but it cannot be the only citation.
- Run the citation validator before a finding reaches the user.

## Scope rules

- Capture one page group at a time. Never capture the whole app.
- Tell the user which group and pages will be captured before capture starts.
- Use the page groups listed in `AGENTS.md`.

## Code rules

- TypeScript strict. Do not use `any` unless you explain why in a comment.
- Keep business logic in `packages/core`. The MCP, CLI, and board layers stay thin.
- Do not add a dependency without explaining why, its install cost, and what you considered
  instead.
- Write only inside the project and `.fittingroom/`.
- Bind local servers to `127.0.0.1`.

## Style

- Use plain English, short sentences, and active voice.
- No em dashes.
- No exclamation marks in error messages.
- No emoji in UI copy.
- Test names describe behavior, for example `captures only the auth pages when scope is auth`.

## Commits

Use conventional commits:

```text
feat: add scope picker
fix: correct contrast check
test: cover target size rule
docs: explain citation policy
chore: update Biome
```

Create a branch per task. Examples: `feat/scope-picker`, `fix/contrast-check`.

## Changesets

Run `pnpm changeset` for any user-facing change. Pick the affected packages and the semver bump.
Commit the generated changeset file with the change.

## Security

Do not report a vulnerability in a public issue. Follow `SECURITY.md`.

## Conduct

All contributors follow `CODE_OF_CONDUCT.md`.
