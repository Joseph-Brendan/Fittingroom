# Fitting Room

Try your UI on before you ship it.

Fitting Room is an open-source MCP server and CLI for vibe coders. It captures one page group from
your app, audits the UI with a citation on every finding, shows four redesign directions on a local
board, and hands your chosen design back to your coding agent.

> Status: early build. Route discovery, scoped capture, automated checks, directions, variant
> registration, board editing, handoff and verification work against the fixtures.

## Why

Coding agents can produce a working screen fast. They are less reliable at judging whether the
screen is clear, accessible, and consistent with the rest of the product.

Fitting Room gives the agent and the user a shared place to look at the UI, compare directions, make
edits, and verify the result.

## Requirements

- Node 24 LTS.
- pnpm 10.6.1. Use Corepack to match the pinned version.
- Chromium for the browser tests. Playwright installs it with `pnpm exec playwright install chromium`.

## Setup

```bash
corepack enable
pnpm install
pnpm exec playwright install chromium
pnpm test
```

## Commands

| Command          | What it does                                  |
| ---------------- | --------------------------------------------- |
| `pnpm build`     | Builds every package.                         |
| `pnpm lint`      | Runs Biome checks.                            |
| `pnpm format`    | Formats with Biome.                           |
| `pnpm typecheck` | Runs strict TypeScript checks.                |
| `pnpm test`      | Runs the Vitest unit and browser tests.       |
| `pnpm test:e2e`  | Runs the Playwright browser test.             |
| `pnpm changeset` | Creates a changeset for a user-facing change. |

The board can be started on its own with `pnpm --filter @fittingroom/board dev`. It listens on
`127.0.0.1:5173`. The CLI serves the comparison board with `fitroom board --state <file>`, binding to
`127.0.0.1` and printing a URL with a random session token.

## Packages

| Package               | Purpose                                                  |
| --------------------- | -------------------------------------------------------- |
| `packages/core`       | Capture, audit, detection, and diffing. Pure TypeScript. |
| `packages/mcp`        | MCP server over stdio. Thin layer over `core`.           |
| `packages/board`      | Vite and React comparison board with preview iframes.    |
| `packages/cli`        | The `fitroom` command. Starts the board and runs audits. |
| `packages/directions` | 36 design directions, their schema and slot specs.       |
| `packages/citations`  | Citation registry and validator.                         |

`fixtures/bad-ui` and `fixtures/good-ui` are small static pages for capture and audit tests.
`fixtures/bad-ui` has one known bug for contrast, target size, focus visibility, and reflow.
`fixtures/good-ui` has no known bugs. `fixtures/scope-app` has 14 routes across five groups for
scope selection tests. `fixtures/handoff` has a reference page, a matching correct implementation,
and a bad implementation for verification tests.

## Scope selection

Fitting Room captures one saved scope at a time. A scope has an id, a display name, and route paths.
The defaults follow the page groups. You can rename, merge, or split them, and the result is saved
to `.fittingroom/scopes.json` for the next run.

The default scope comes from the route in view, using `FITTINGROOM_CURRENT_PATH` or the local dev
request tracker. If neither is set, Fitting Room uses the most recently edited route file. If it
still cannot choose, the CLI asks.

```bash
fitroom audit
fitroom audit --scope auth
fitroom audit --pages /login,/signup
fitroom scopes
fitroom scopes rename auth "Sign in"
fitroom scopes merge marketing settings
fitroom scopes split auth --name Verification --pages /verify
```

`fitroom audit` with no flags prints the saved scopes as a checklist and pre-ticks the default
scope. The `--scope` and `--pages` flags skip the prompt. Before capture starts, the CLI prints and
returns a summary such as:

```text
Capturing: Authentication (4 pages): /login /signup /forgot-password /verify, at 375, 768 and 1440 px.
```

When the audit finishes, it saves `.fittingroom/audits/<scope>/findings.json` and
`.fittingroom/audits/<scope>/report.html`. The CLI prints both full paths. Findings for the same
element and root problem merge into one finding with a primary citation and a related list.

Call `recordDevServerRequest` from a local dev server hook to update `.fittingroom/last-request.json`.
Set `FITTINGROOM_CURRENT_PATH` to supply the current route directly.

## Comparison board

The comparison board shows four variants in a grid. Each card loads a live preview iframe, the
direction name, its rationale and its finding count. The viewport switch resizes every preview to
375, 768 or 1440 pixels. The findings drawer groups findings by severity and links each citation.

"Try another direction" opens a WebSocket request to the local board host. The CLI protects the
board, preview routes, API and WebSocket with a random session token in the URL. The
`GET /api/direction-requests` endpoint exposes received requests for the MCP-side bridge.

The board has a Regenerate all button and a regenerate control on every card. Slot 1 supports
light-touch and deeper-polish modes. Cards can be pinned, and the Previous strip shows earlier
rounds. Regeneration and pins are saved in `.fittingroom/history.json`. The board UI uses API
controllers backed by the same core regeneration engine as `fr_regenerate`.

Clicking an element inside a preview opens the inspector. Connected design systems show token-only
color, spacing, radius and type controls, plus a custom value warning. The inspector supports delete,
duplicate, project-first insert, and dnd-kit reordering within the same parent. Every edit is sent to
the board edit API and reloads the iframe. Undo restores the previous edit.

## MCP tools

The MCP server exposes these tools over stdio:
- `fr_scopes` lists saved scopes, the default scope, and the group for the current page.
- `fr_capture` captures one page group and returns the scope summary and screenshot paths.
- `fr_audit` captures one page group, runs automated checks, and returns a critique brief.
- `fr_directions` builds the four design slots for a route.
- `fr_regenerate` replaces unpinned slots and saves the previous round.
- `fr_register_variant` type-checks, renders, screenshots, and audits a variant.
- `fr_handoff` writes a local handoff folder and implementation brief.
- `fr_verify` compares a real route with a handoff.
- `fr_submit_findings` validates judged findings and merges them with the latest audit.

`fr_capture` and `fr_audit` accept an optional `scope` or `pages` argument. Without either, they use
the default scope. If no default can be found, they return a scope checklist for the agent to ask
the user about.

## Slop score

`detectSlop(captures)` checks captured pages for eight common template patterns: purple to blue
gradient heroes, three identical feature cards, emoji used as icons, every section centered, one
font at one weight, glow or gradient on most buttons, generic headline phrases, and stock 3D blobs.
Each rule has a weight and returns evidence with the page path and selector. The score is capped at
100.

`renderSlopScoreCard(report, path)` writes a 1200 by 630 PNG with the score, the top three rules,
and the label "Checked with Fitting Room".

## Handoff and verify

`fr_handoff` writes `.fittingroom/handoffs/<handoffId>/`. The folder contains the selected design
source, three reference screenshots, the design tokens, `handoff.json`, and `brief.md`. The brief
tells the agent to apply the design to the real route, reuse existing components, keep data wiring
and real content, and call `fr_verify`.

`fr_verify` captures the route at 375, 768 and 1440 px. It writes the actual and diff screenshots
under `.fittingroom/verifications/`. The build passes when every region has under 2% pixel
difference, and when there are zero computed style mismatches against the handoff tokens and zero
content order mismatches. The report lists every mismatch with the element id and property.

The `heuristic-review` prompt guides an agent through a Nielsen heuristic review. Set
`FITTINGROOM_CURRENT_PATH` to the route in view, or pass `currentPath` when creating the server in
code. The scope commands above update the same `.fittingroom/scopes.json` file that the MCP server
reads.

## How it works

1. Capture one page group at a time.
2. Audit the captured pages. Every finding has a citation from the registry.
3. Generate four directions. Slot 1 is always Refined. Slots 2 to 4 use direction specs that match
   the page group.
4. Show the directions on a local board. The user edits and picks one.
5. Hand the chosen design back to the agent.
6. Verify the build against the chosen design.

## Local only

Fitting Room runs on the user's machine. The board binds to `127.0.0.1`. Source code, screenshots,
and findings stay local. Telemetry is off unless the user opts in.

## Edit engine

The core edit engine applies `set-token`, `set-text`, `move`, `delete`, `duplicate`, `insert`, and
`swap-section` operations to variant TSX files. It finds elements by `data-fr-id`, applies changes
with ts-morph, and returns formatted TSX. Every operation is appended to `.fittingroom/edits.json`
with a timestamp. Off-system token values are allowed and marked `offSystem: true`. Undo replays the
log without its last operation.

## Design system detection

`detectDesignSystem` checks Tailwind v4 `@theme`, Tailwind v3 config, DTCG token files, CSS
variables on `:root`, shadcn/ui, and component libraries such as MUI. It normalizes every token into
`color`, `space`, `radius`, `font`, `fontSize` and `shadow`, and reports missing categories. When a
system is partial or missing, Fitting Room writes `.fittingroom/tokens.json` for the missing parts.

## Citations

Every audit finding needs a citation ID from `packages/citations/registry.json`. The validator
checks the registry before findings reach the user. Approved sources are WCAG 2.2, Nielsen's 10
Usability Heuristics, the NN/g 0 to 4 severity scale, Apple Human Interface Guidelines, Material
Design 3, WAI-ARIA Authoring Practices Guide, and Laws of UX.

## Contributing

Read `CONTRIBUTING.md` and `AGENTS.md` before you change code. The short version is test first, one
feature per pull request, and plain English in everything a user reads.

## License

Apache-2.0. See `LICENSE`.
