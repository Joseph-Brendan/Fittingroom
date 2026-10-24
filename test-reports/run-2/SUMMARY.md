# Fitting Room release test run 2

| Item                        | Result                                  |
| --------------------------- | --------------------------------------- |
| Overall result              | PASS for D1 to D7 and the real app loop |
| Rounds                      | 5 of 5 PASS                             |
| Shop-app real loop          | PASS                                    |
| Metrics-dashboard real loop | PASS                                    |
| Pack and stranger install   | PASS                                    |
| Final checks                | PASS                                    |
| Needs Joseph                | None                                    |

## Commits

| Commit    | Work                                             |
| --------- | ------------------------------------------------ |
| `9bf693b` | Baseline D1 commit at the start of run 2         |
| `1d0086d` | D2 to D7 workflow, fixes, tests and changeset    |
| `b19675a` | Real app evidence, screenshots and round reports |
| `f5f03ca` | Run 2 summary                                    |

## Final checks

| Check            | Result                               |
| ---------------- | ------------------------------------ |
| Node             | `v24.22.1`                           |
| pnpm             | `10.6.1`                             |
| Build            | PASS                                 |
| Lint             | PASS, 354 files                      |
| Typecheck        | PASS                                 |
| Unit tests       | PASS, 196 tests in 36 test files     |
| Browser tests    | PASS, 16 tests                       |
| Package contents | PASS, 7 files, all in `dist`         |
| Stranger audit   | PASS, findings match the linked copy |

Package test totals:

| Package    | Tests |
| ---------- | ----- |
| citations  | 11    |
| board      | 3     |
| directions | 5     |
| core       | 118   |
| mcp        | 21    |
| cli        | 38    |

Logs are in `test-reports/run-2/logs/final/`.

## Rounds

| Round                                       | Result | Evidence                                                                                    |
| ------------------------------------------- | ------ | ------------------------------------------------------------------------------------------- |
| Round 1: clean install and automated checks | PASS   | Build, lint, typecheck, 196 unit tests and 16 browser tests                                 |
| Round 2: CLI on the fixtures                | PASS   | Planted bugs found once, good-ui has zero findings                                          |
| Round 3: the board in a real browser        | PASS   | Shop-app connected banner, tokens first, off-system color, structure and approval           |
| Round 4: the full loop through MCP          | PASS   | Shop-app and metrics-dashboard audit, review, board, edits, handoff, verify and wrong build |
| Round 5: install like a stranger            | PASS   | Pack, install outside the repo and audit on port 3000                                       |

## Failures found and fixed per round

| Round   | Failure                                                                    | Test                                                                                          | Fix                                                                                            |
| ------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Round 1 | None                                                                       | None                                                                                          | None                                                                                           |
| Round 2 | None                                                                       | None                                                                                          | None                                                                                           |
| Round 3 | Connected banner disappeared after Generate                                | `keeps the connected design system after a board request`                                     | Board server merges the in-memory design system and scopes after file updates                  |
| Round 3 | Information design was empty for a fragment with a style tag               | `finds blocks inside a fragment with a style tag`                                             | Block finder prefers `main` and skips style and script elements                                |
| Round 4 | Handoff used the preview from registration, not the current variant        | `renders the current variant file before writing the handoff`                                 | `fr_handoff` re-renders the current variant before writing                                     |
| Round 4 | Verify treated style tags and inherited border colors as design mismatches | `ignores style elements in the handoff style map`, `does not fail on inherited border colors` | Skip style, script, link and meta elements, and do not compare inherited border colors         |
| Round 4 | Design memory used defaults instead of the approved variant                | Handoff freshness test checks the button color and saved colors                               | Memory reads the approved reference for colors, fonts, sizes, spacing, radii, button and input |
| Round 4 | Shop-app inputs differed between preview and real page                     | Full loop verify                                                                              | The approved variant sets input background, color and line height                              |
| Round 5 | None                                                                       | None                                                                                          | None                                                                                           |

## First run vs second run

| First run item                                  | First result         | Second result | Second run evidence                               |
| ----------------------------------------------- | -------------------- | ------------- | ------------------------------------------------- |
| R3 step 4: MCP directions reach the board       | FAIL, BLOCKED        | PASS          | Board bridge, cards appear live                   |
| R3 step 5: show 4 real cards at all widths      | PARTIAL              | PASS          | `shop-board-cards.png` and real board             |
| R3 step 6: regenerate in the real board         | FAIL                 | PASS          | Board browser tests and live updates              |
| R3 step 7: pin, regenerate one, restore         | FAIL, BLOCKED        | PASS          | Round restore browser test                        |
| R3 step 8: real board editor and undo           | FAIL, BLOCKED        | PASS          | Real file edit, undo, redo under 2 seconds        |
| R3 step 9: information design and structure     | FAIL, BLOCKED        | PASS          | Shop structure sparse, metrics structure dense    |
| R3 step 10: real board findings drawer          | FAIL                 | PASS          | Board browser test with citations                 |
| R3 step 11: shop-app board directions and cards | PARTIAL              | PASS          | Shop real board and screenshots                   |
| R3 design system banner on shop-app             | FAIL, fixed in run 1 | PASS          | Banner and tokens captured again                  |
| R4 step 1: tool list                            | FAIL, missing tools  | PASS          | `fr_design_memory` and `fr_states` exist          |
| R4 step 6: board approval flow                  | FAIL, BLOCKED        | PASS          | Shop and metrics approve Refined in slot 1        |
| R4 step 9: design memory                        | FAIL, BLOCKED        | PASS          | `DESIGN.md`, `design-memory.json`, audit findings |
| R4 step 10: states check                        | FAIL, BLOCKED        | PASS          | Metrics states report and screenshots             |
| R5 install like a stranger                      | BLOCKED              | PASS          | Tarball installed and audited port 3000           |

## Real app results

Shop-app authentication:

| Item          | Result                                                    |
| ------------- | --------------------------------------------------------- |
| MCP cwd       | `shop-app`                                                |
| Scope         | Authentication, `/login` and `/signup`                    |
| Audit         | 4 measured target size findings, all `wcag22-2.5.8`       |
| Judged review | 1 finding, `nielsen-h9`, severity 2                       |
| Board         | 4 cards, connected design system, 2 edits, density sparse |
| Approval      | Refined, slot 1                                           |
| Handoff       | `handoff-b411d0b7`                                        |
| Verify        | PASS, 27 regions, 0 failing                               |
| Wrong build   | FAIL, 8 failing regions                                   |
| Design memory | Files present, `fr_design_memory` returns them            |

Metrics-dashboard:

| Item          | Result                                                    |
| ------------- | --------------------------------------------------------- |
| MCP cwd       | `metrics-dashboard`                                       |
| Scope         | Dashboard, `/analytics` and `/dashboard`                  |
| Audit         | 4 measured target size findings, all `wcag22-2.5.8`       |
| Judged review | 1 finding, `nielsen-h1`, severity 2                       |
| Board         | 4 cards, 2 edits, density dense                           |
| Approval      | Refined, slot 1                                           |
| Handoff       | `handoff-0a03f9ed`                                        |
| Verify        | PASS, 27 regions, 0 failing                               |
| Wrong build   | FAIL, 5 failing regions                                   |
| Design memory | 0 findings on `/dashboard`, 3 findings on `/analytics`    |
| States        | Empty, loading, error not reachable, long PASS, dark PASS |

## Shop-app Round 3 evidence

| Item               | Value                                                     |
| ------------------ | --------------------------------------------------------- |
| Banner             | `Design system connected: Tailwind v4 @theme, shadcn/ui.` |
| First color tokens | brand, brand-dark, ink, paper, card, line                 |
| Custom color       | `#ff00ff`                                                 |
| Off system         | `true`                                                    |
| Structure          | `auth`, `/login`, `sparse`, one hero block                |

## Round 5 file list

```text
npm notice Tarball Contents
npm notice 9.0kB dist/board/assets/index-CMBZ724r.css
npm notice 292.2kB dist/board/assets/index-DxcBO1Hn.js
npm notice 480B dist/board/index.html
npm notice 20B dist/index.d.ts
npm notice 415.8kB dist/index.js
npm notice 797.6kB dist/index.js.map
npm notice 1.1kB package.json
npm notice Tarball Details
npm notice name: fitting-room
npm notice version: 0.0.0
npm notice filename: fitting-room-0.0.0.tgz
npm notice package size: 332.0 kB
npm notice unpacked size: 1.5 MB
npm notice shasum: 5c9ad22fef758724613ffdb86b36cb30dbcb15f9
npm notice integrity: sha512-lK0svdsWlM1z5[...]OH9/K6ndPqb9g==
npm notice total files: 7
```

The full raw output is in `test-reports/run-2/logs/round-5/npm-pack-dry-run.log`.

## Round 5 audit comparison

Both installs printed the same three findings:

```text
/: contrast failure, wcag22-1.4.3, severity 3
/: focused control hidden, wcag22-2.4.11, severity 3
/pricing: missing image alt, wcag22-1.1.1, severity 4
```

```text
Match ignoring generatedAt: true
Findings: 3
```

## Screenshot paths for Round 3

- `test-reports/run-2/screenshots/round-3/shop-board-request.png`
- `test-reports/run-2/screenshots/round-3/shop-board-connected.png`
- `test-reports/run-2/screenshots/round-3/shop-inspector-tokens.png`
- `test-reports/run-2/screenshots/round-3/shop-offsystem-color.png`
- `test-reports/run-2/screenshots/round-3/shop-structure-density.png`

## Screenshot paths for Round 4

Shop-app:
- `test-reports/run-2/screenshots/round-4/shop-board-request.png`
- `test-reports/run-2/screenshots/round-4/shop-board-cards.png`
- `test-reports/run-2/screenshots/round-4/shop-banner-connected.png`
- `test-reports/run-2/screenshots/round-4/shop-inspector-tokens.png`
- `test-reports/run-2/screenshots/round-4/shop-offsystem-color.png`
- `test-reports/run-2/screenshots/round-4/shop-structure-density.png`
- `test-reports/run-2/screenshots/round-4/shop-board-approved.png`
- `test-reports/run-2/screenshots/round-4/shop-real-login-after.png`
- `test-reports/run-2/screenshots/round-4/shop-verify-pass-375.png`
- `test-reports/run-2/screenshots/round-4/shop-verify-pass-768.png`
- `test-reports/run-2/screenshots/round-4/shop-verify-pass-1440.png`
- `test-reports/run-2/screenshots/round-4/shop-real-login-wrong.png`
- `test-reports/run-2/screenshots/round-4/shop-verify-wrong-375.png`
- `test-reports/run-2/screenshots/round-4/shop-verify-wrong-768.png`
- `test-reports/run-2/screenshots/round-4/shop-verify-wrong-1440.png`

Metrics-dashboard:
- `test-reports/run-2/screenshots/round-4/metrics-board-request.png`
- `test-reports/run-2/screenshots/round-4/metrics-board-cards.png`
- `test-reports/run-2/screenshots/round-4/metrics-inspector.png`
- `test-reports/run-2/screenshots/round-4/metrics-edits.png`
- `test-reports/run-2/screenshots/round-4/metrics-structure-density.png`
- `test-reports/run-2/screenshots/round-4/metrics-board-approved.png`
- `test-reports/run-2/screenshots/round-4/metrics-real-dashboard-after.png`
- `test-reports/run-2/screenshots/round-4/metrics-verify-pass-375.png`
- `test-reports/run-2/screenshots/round-4/metrics-verify-pass-768.png`
- `test-reports/run-2/screenshots/round-4/metrics-verify-pass-1440.png`
- `test-reports/run-2/screenshots/round-4/metrics-real-dashboard-wrong.png`
- `test-reports/run-2/screenshots/round-4/metrics-verify-wrong-375.png`
- `test-reports/run-2/screenshots/round-4/metrics-verify-wrong-768.png`
- `test-reports/run-2/screenshots/round-4/metrics-verify-wrong-1440.png`
- `test-reports/run-2/screenshots/round-4/metrics-states-empty-1440.png`
- `test-reports/run-2/screenshots/round-4/metrics-states-loading-1440.png`
- `test-reports/run-2/screenshots/round-4/metrics-states-error-1440.png`
- `test-reports/run-2/screenshots/round-4/metrics-states-long-320.png`
- `test-reports/run-2/screenshots/round-4/metrics-states-dark-1440.png`

## Every repo file changed

| Area                   | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root config            | `.gitignore`, `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `playwright.config.ts`                                                                                                                                                                                                                                                                                                                                                                  |
| Changeset              | `.changeset/d2-d7-review-workflow.md`                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Board                  | `packages/board/src/App.tsx`, `packages/board/src/Inspector.tsx`, `packages/board/src/styles.css`, `packages/board/src/types.ts`                                                                                                                                                                                                                                                                                                                         |
| Citations              | `packages/citations/registry.json`, `packages/citations/src/index.ts`, `packages/citations/test/validation.test.ts`                                                                                                                                                                                                                                                                                                                                      |
| CLI                    | `packages/cli/src/board-command.ts`, `packages/cli/src/board-server.ts`, `packages/cli/test/board.test.ts`, `packages/cli/test/board-bridge.test.ts`                                                                                                                                                                                                                                                                                                     |
| Core source            | `packages/core/src/board-state.ts`, `packages/core/src/design-memory.ts`, `packages/core/src/edit-engine.ts`, `packages/core/src/handoff.ts`, `packages/core/src/index.ts`, `packages/core/src/rounds.ts`, `packages/core/src/states.ts`, `packages/core/src/structure.ts`                                                                                                                                                                               |
| Core tests             | `packages/core/test/board-state.test.ts`, `packages/core/test/design-memory.test.ts`, `packages/core/test/rounds.test.ts`, `packages/core/test/states.test.ts`, `packages/core/test/structure.test.ts`, `packages/core/test/variant-editor.test.ts`, `packages/core/test/verify.test.ts`                                                                                                                                                                 |
| MCP                    | `packages/mcp/src/index.ts`, `packages/mcp/src/preview.ts`, `packages/mcp/src/server.ts`, `packages/mcp/test/directions.test.ts`, `packages/mcp/test/handoff-freshness.test.ts`, `packages/mcp/test/tools.test.ts`                                                                                                                                                                                                                                       |
| E2E                    | `e2e/board-bridge.spec.ts`, `e2e/bridge-server.mts`, `e2e/board-empty.spec.ts`, `e2e/board-server.mts`, `e2e/empty-board-server.mts`                                                                                                                                                                                                                                                                                                                     |
| State fixtures         | `fixtures/bad-ui/state-empty-good.html`, `fixtures/bad-ui/state-empty-bad.html`, `fixtures/bad-ui/state-loading-good.html`, `fixtures/bad-ui/state-loading-bad.html`, `fixtures/bad-ui/state-error-good.html`, `fixtures/bad-ui/state-error-bad.html`, `fixtures/bad-ui/state-long-good.html`, `fixtures/bad-ui/state-long-bad.html`, `fixtures/bad-ui/state-dark-good.html`, `fixtures/bad-ui/state-dark-bad.html`, `fixtures/bad-ui/state-no-api.html` |
| Design memory fixtures | `fixtures/design-memory/styles.css`, `fixtures/design-memory/good.html`, `fixtures/design-memory/break-color.html`, `fixtures/design-memory/break-font.html`, `fixtures/design-memory/break-size.html`, `fixtures/design-memory/break-spacing.html`, `fixtures/design-memory/break-radius.html`, `fixtures/design-memory/break-button.html`                                                                                                              |
| Handoff fixtures       | `fixtures/handoff/reference/index.html`, `fixtures/handoff/correct/index.html`, `fixtures/handoff/bad/index.html`                                                                                                                                                                                                                                                                                                                                        |
| Round reports          | `test-reports/run-2/round-1.md`, `round-2.md`, `round-3.md`, `round-4.md`, `round-5.md`, `SUMMARY.md`                                                                                                                                                                                                                                                                                                                                                    |
| Scripts                | `test-reports/run-2/scripts/shop-loop.mjs`, `test-reports/run-2/scripts/metrics-loop.mjs`                                                                                                                                                                                                                                                                                                                                                                |
| Logs                   | `test-reports/run-2/logs/final/`, `logs/round-1/`, `logs/round-3/`, `logs/round-4/`, `logs/round-5/`                                                                                                                                                                                                                                                                                                                                                     |
| Screenshots            | `test-reports/run-2/screenshots/round-3/`, `test-reports/run-2/screenshots/round-4/`                                                                                                                                                                                                                                                                                                                                                                     |

## External app files changed

| App               | Files                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------- |
| shop-app          | `variants/refined.tsx`, `variants/native.tsx`, `variants/bold.tsx`, `variants/wildcard.tsx` |
| metrics-dashboard | `variants/refined.tsx`, `variants/native.tsx`, `variants/bold.tsx`, `variants/wildcard.tsx` |

Both apps also generated `.fittingroom` evidence. Those folders are test output and are not committed.

## Notes

| Item         | Detail                                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| D2 to D7     | Were missing at the start of this continuation. They are built and covered by tests.                                       |
| Citations    | The `project-design-memory` entry points at `.fittingroom/DESIGN.md`. No citation was guessed.                             |
| Security     | The board stayed on `127.0.0.1`. No source, screenshots or findings left the machine.                                      |
| Cleanup      | The shop-app, metrics-dashboard and bad-ui dev servers were stopped. The stranger install folder and tarball were removed. |
| Needs Joseph | None.                                                                                                                      |
