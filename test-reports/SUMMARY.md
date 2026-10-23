# Fitting Room full release test summary

## Result

The run did not reach five passes. Rounds 1 and 2 pass. Round 3 and Round 4 fail because product features are missing. Round 5 is blocked by packaging and publishing. The final regression of Rounds 1 and 2 passes.

## Round table

| Round                                       | Final result | Failures found | Failures fixed | Blocked |
| ------------------------------------------- | ------------ | -------------: | -------------: | ------: |
| Round 1: Clean install and automated checks | PASS         |              0 |              0 |       0 |
| Round 2: CLI on the fixtures                | PASS         |              1 |              1 |       0 |
| Round 3: The board in a real browser        | FAIL         |              5 |              1 |       4 |
| Round 4: The full loop through MCP          | FAIL         |              7 |              4 |       3 |
| Round 5: Install like a stranger            | BLOCKED      |              1 |              0 |       1 |
| Final regression: Rounds 1 and 2            | PASS         |              0 |              0 |       0 |

Totals: 14 failures found, 6 fixed, 8 blocked.

## Fixed failures

1. `fitroom scopes` printed `1 pages` for one-page groups. Fixed in Round 2.
2. The board showed `Design system not found` for a connected app. Fixed in Round 3.
3. Findings from different pages shared the same id and collapsed in the MCP merge. Fixed in Round 4.
4. The MCP server picked the wrong app when several dev servers ran. Fixed in Round 4.
5. The handoff folder was missing tokens, structure, edits, fixed findings and checklist files. Fixed in Round 4.
6. The slop tool was missing from MCP. Fixed in Round 4.

Each fix has a failing test first, a root cause, a code change and proof in the round report.

## Blocked work

- Board to MCP bridge: directions, variants, previews and findings do not reach a running board. There is no approval action.
- Real board editor and undo are not wired. The board endpoints return 501.
- Restore a variant from an earlier round is missing.
- Information design panel and `structure.json` are missing.
- Design memory and `DESIGN.md` are missing.
- States check for empty, loading, error, long text and dark mode is missing.
- The npm tarball cannot install outside the workspace because the CLI depends on unpublished `workspace:*` packages.

## Final regression

Rounds 1 and 2 were run again from scratch after Round 5.

Round 1:
- Clean install: PASS.
- Chromium install: PASS.
- Build: PASS.
- Lint: PASS, 270 files.
- Typecheck: PASS.
- Unit tests: PASS, 141 tests in 27 test files.
- Browser tests: PASS, 12 tests.

Round 2:
- Global link and help: PASS.
- Picker and grammar: PASS.
- All 7 bad-ui groups: PASS.
- Findings JSON validation: PASS, 7 measured findings, bugs 1 to 7 found once each.
- All 7 good-ui groups: PASS, zero measured findings.
- `--pages`: PASS, only `/login` and `/signup` captured.
- No-server errors: PASS, plain messages.
- Broken element: PASS, `Checks that hit errors` appeared and the audit finished.

The first final regression run failed lint because of formatting in the test report scripts. That was fixed elsewhere in the report scripts, the full Round 1 sequence was rerun, and it passed.

## Test apps created

The two real apps are outside the repo.

`/Users/josephbrendan/Documents/fr-test-apps/shop-app`
- Next.js App Router, Tailwind v4 `@theme`, shadcn/ui.
- Routes: `/`, `/login`, `/signup`, `/settings`.
- Dev port: 3100.
- Design system detection: connected with `tailwind-v4` and `shadcn`.

`/Users/josephbrendan/Documents/fr-test-apps/metrics-dashboard`
- Next.js App Router, plain CSS, no design system.
- Routes: `/`, `/dashboard`, `/analytics`, `/reports`.
- Dev port: 3200.
- Design system detection: none.

Key files in shop-app:
- `package.json`, `next.config.ts`, `postcss.config.mjs`, `tsconfig.json`, `components.json`
- `app/layout.tsx`, `app/page.tsx`, `app/login/page.tsx`, `app/signup/page.tsx`, `app/settings/page.tsx`, `app/globals.css`
- `components/ui/button.tsx`, `components/site-header.tsx`
- `variants/refined.tsx`, `variants/native.tsx`, `variants/bold.tsx`, `variants/wildcard.tsx`, `variants/bad-render.tsx`, `variants/bad-contrast.tsx`

Key files in metrics-dashboard:
- `package.json`, `next.config.ts`, `tsconfig.json`
- `app/layout.tsx`, `app/page.tsx`, `app/dashboard/page.tsx`, `app/analytics/page.tsx`, `app/reports/page.tsx`, `app/globals.css`
- `components/app-header.tsx`
- `variants/refined.tsx`, `variants/native.tsx`, `variants/bold.tsx`, `variants/wildcard.tsx`, `variants/bad-render.tsx`, `variants/bad-image.tsx`

Generated `.fittingroom` folders in both apps contain captures, audits, previews, handoffs and verifications. They are not source.

## Files changed in the repo

Round 2 fixes:
- `packages/cli/src/scopes.ts`
- `packages/cli/test/audit.test.ts`

Round 3 fixes:
- `packages/cli/src/board-command.ts`
- `packages/cli/test/board.test.ts` (new)

Round 4 fixes:
- `packages/core/src/audit.ts`
- `packages/core/test/audit.test.ts`
- `packages/core/src/dev-server.ts`
- `packages/core/test/dev-server.test.ts`
- `packages/core/src/handoff.ts`
- `packages/core/test/verify.test.ts`
- `packages/cli/src/audit.ts`
- `packages/mcp/src/server.ts`
- `packages/mcp/test/tools.test.ts`
- `README.md`

Reports and evidence:
- `test-reports/round-1.md`
- `test-reports/round-2.md`
- `test-reports/round-3.md`
- `test-reports/round-4.md`
- `test-reports/round-5.md`
- `test-reports/SUMMARY.md`
- `test-reports/scripts/` (all scripts)
- `test-reports/logs/` (all round logs and regression logs)
- `test-reports/screenshots/round-3/`
- `test-reports/screenshots/round-4/`

Round 1 committed the existing project baseline on `test/full-run`. The commits are:
- `f6e5f16 test: round 1 passes`
- `ba420dc test: round 2 passes`
- Final commit with the Round 3 to Round 5 reports and fixes.

## Needs Joseph

1. Publish `@fittingroom/core`, `@fittingroom/citations`, `@fittingroom/directions` and `@fittingroom/board` to npm, or approve a CLI bundling strategy. Then rerun Round 5.
2. Define and approve the MCP to board bridge and the direction approval flow.
3. Define the editor and information design panel behavior, including the `structure.json` format.
4. Define how restore from an earlier round should work.
5. Define design memory: `DESIGN.md` content and what counts as breaking the saved design.
6. Define the states check: how to trigger each state and what counts as a pass.
