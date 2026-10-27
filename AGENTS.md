# AGENTS.md

Rules for any AI agent working on Fitroom. Read this file fully before you write code. If a rule here conflicts with a prompt, follow this file and say so.

## What we are building

Fitroom is an open-source MCP server and CLI for vibe coders. It captures the UI an agent built, audits it with a citation on every finding, shows 4 redesign directions as real code on a local board, lets the user edit them, hands the chosen design back to the agent, and checks the build matches it.

Tagline: Try your UI on before you ship it.

## Non-negotiable rules

1. **Test first. Always.** Write a failing test, run it, see it fail, then write the code that makes it pass, then clean up. No feature code without a failing test before it. If you skip this, the change will be rejected.
2. **Every audit finding needs a citation ID** from `packages/citations/registry.json`. No ID, no finding. Never type a URL into a finding. Never invent an ID.
3. **No em dashes** anywhere: docs, UI copy, error messages, comments, commit messages, test names. Use a period, a comma, a colon, or parentheses instead.
4. **Plain English.** Short sentences. Active voice. Lead with the main point. No jargon in anything a user reads.
5. **Capture one page group at a time.** Never capture the whole app. Always tell the user which group and pages before capture starts.
6. **Slot 1 is always Refined.** On every generate and regenerate, slot 1 improves the user's own design in its own style. It never gets a library direction.
7. **Local only.** Nothing leaves the user's machine. No telemetry unless the user opts in. The board binds to `127.0.0.1` only.

## Repo layout

```text
packages/
  core/         capture, scopes, audit, design system detection, edit engine, verify
  mcp/          MCP server (stdio) exposing core as fr_* tools
  board/        Vite + React design board
  cli/          the `fitroom` command
  directions/   design direction specs (JSON) and their schema
  citations/    citation registry and validator
fixtures/       small apps with known UI bugs, used by tests
docs/           docs site source
```

Keep logic in `core`. `mcp`, `cli` and `board` are thin layers over it.

## Commands

```bash
pnpm install
pnpm test            # Vitest unit tests, all packages
pnpm test:e2e        # Playwright browser tests
pnpm lint            # Biome
pnpm typecheck       # tsc --noEmit, strict
pnpm build           # tsup
pnpm changeset       # add a changeset for any user-facing change
```

Run `pnpm lint && pnpm typecheck && pnpm test` before you say a task is done. Paste the result. If anything fails, the task is not done.

## Stack

- TypeScript, strict mode. No `any` unless you explain why in a comment.
- Node 24 LTS, pnpm workspaces.
- Official MCP TypeScript SDK, stdio transport.
- Playwright (Chromium) for capture. axe-core for accessibility rules.
- ts-morph for code edits. pixelmatch for image diffs.
- Vite, React, dnd-kit for the board. WebSocket for board to server sync.
- Vitest and Playwright Test. Biome. Changesets.

Do not add a dependency without saying why, what it costs in install size, and what you considered instead.

## How to work

1. Restate the task in one or two sentences.
2. List the tests you will write.
3. Write the tests. Run them. Show they fail for the right reason.
4. Write the smallest code that passes.
5. Refactor. Run everything again.
6. Report: what changed, test results, anything you were unsure about.

Keep each change small. One feature or fix per pull request. If a task is big, split it and say how.

## Testing rules

- Every planted bug in `fixtures/bad-ui` must produce exactly one finding with the right citation ID.
- `fixtures/good-ui` must produce zero findings. A false positive is a bug.
- Edit engine tests are before file, operation, expected after file.
- Browser tests use Playwright and real fixtures, not mocks of the DOM.
- Test names describe behavior in plain English: `captures only the auth pages when scope is auth`.
- Never weaken or delete a test to make it pass. If a test is wrong, say so and explain.

## Audit and citation rules

- Approved sources only: WCAG 2.2, Nielsen's 10 Usability Heuristics, the NN/g 0 to 4 severity scale, Apple Human Interface Guidelines, Material Design 3, WAI-ARIA Authoring Practices Guide, Laws of UX.
- Laws of UX can support a finding but can never be its only citation.
- WCAG 3 is a working draft. Do not cite it.
- Registry URLs come only from `w3.org`, `nngroup.com`, `developer.apple.com`, `m3.material.io` and `lawsofux.com`.
- Every finding has: `id`, `title`, `citation`, `severity` (0 to 4), `confidence` (`measured` or `judged`), `evidence`, `fix`.
- Automated checks are `measured` and hard-wire their citation in code. AI findings are `judged`.
- Evidence must point to something real: a selector, a screenshot crop, a measured value.
- Run the validator on every finding before it reaches the user.

## Page scope rules

- Page groups: marketing, authentication, onboarding, dashboard, app screens, settings, checkout.
- Default scope is the page the user is viewing or the route the agent last edited. If unknown, ask.
- Show a scope summary before capture: group name, page list, widths, estimated time.
- Save user changes to groups in `.fitroom/scopes.json`.
- Directions, edits, handoff and verify all apply to the chosen scope only.

## Direction and regenerate rules

- Slots: 1 Refined, 2 Native, 3 Bold, 4 Wildcard.
- Only offer directions whose `surfaces` include the detected page group.
- Refined has two modes: `light` (audit fixes only) and `deep` (also spacing, type and hierarchy). Both keep the user's layout, brand colors, fonts and style.
- Regenerate replaces unpinned slots only. Slots 2 to 4 never repeat a direction in `.fitroom/history.json` for that scope until the list runs out.
- Every variant ships with a one-line rationale in plain English.
- Variants keep all real content. No placeholder or lorem copy.
- A variant that fails to render or adds a new WCAG AA failure is rejected.

## Design system rules

- Detect in this order: Tailwind v4 `@theme`, Tailwind v3 config, DTCG tokens, CSS custom properties, shadcn/ui, css variables, component libraries, `DESIGN.md`, designkit output.
- The board banner shows one of: connected, partial, not found. Use the exact copy in `packages/board/src/copy.ts`.
- When connected, the inspector offers tokens and project components first.
- Off-system values are allowed but flagged `offSystem: true` and listed in the handoff.
- When not found, save every choice as a token in `.fitroom/tokens.json`. Never write loose values.

## Editing rules

- Every edit is an operation in `edits.json`: `set-token`, `set-text`, `move`, `delete`, `duplicate`, `insert`, `swap-section`.
- Apply operations with ts-morph. Output must look like code a developer wrote: formatted, no inline style soup.
- Moves stay within the same parent. No absolute positioning.
- Undo replays the log minus the last operation.

## Writing rules for anything a user reads

- Lead with what happened or what to do.
- One idea per sentence. Most sentences under 20 words.
- Say "you". Name the page and the element.
- Error messages say what went wrong and how to fix it.
- No em dashes. No exclamation marks in errors. No emoji in UI copy.

Good: `Capturing: Authentication (4 pages). This takes about 40 seconds.`
Bad: `Initiating comprehensive multi-viewport capture sequence — please wait!`

## Security rules

- Bind the board and WebSocket to `127.0.0.1`. Require the session token on every request.
- Never send source code, screenshots or findings over the network.
- Never run user code outside their own dev server.
- Write only inside the project and `.fitroom/`. Never touch files outside the project root.
- Pin GitHub Actions to full commit SHAs. Publish to npm only through OIDC trusted publishing.

## Git rules

- Branch per task: `feat/scope-picker`, `fix/contrast-check`.
- Conventional commits: `feat:`, `fix:`, `test:`, `docs:`, `chore:`.
- Add a changeset for any user-facing change.
- Never commit `.fitroom/` from fixtures runs, secrets or `.env` files.

## When you are unsure

Stop and ask. Do not guess a citation, a direction spec, a design token or a user's intent. A short question is cheaper than a wrong build.

## Licensing
- Pick Apache-2.0 as the license. It includes an explicit patent grant, which fits your defensive publication plan better than MIT.