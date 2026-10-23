# Round 2: CLI on the fixtures

## Result

PASS

## What I tested

1. Global link and help. PASS. Ran `pnpm link --global` in `packages/cli`. `fitroom --help` and `fitroom audit --help` both list and describe `--url`, `--scope` and `--pages`.
2. Picker. PASS. Inside `fixtures/bad-ui`, audited with no scope. The picker listed all 7 groups. Single page groups showed `1 page`, not `1 pages`. No group was pre-ticked and there was no default hint.
3. Every group by scope. PASS. Audited marketing, auth, onboarding, dashboard, app, settings and checkout. Every audit printed the scope summary before capture, printed the full findings JSON and HTML report paths at the end, and exited 0.
4. Findings JSON. PASS. The validation script checked 7 findings JSON files. Every finding had id, title, citation, severity from 0 to 4, confidence, evidence and fix. Every citation and related ID exists in the registry. Every screenshot file exists.
5. Bugs 1 to 7. PASS. All seven were found exactly once on the correct page with the correct citation. Bug 3 is one finding with primary `wcag22-3.3.2` and related `wcag22-4.1.2`. There were 7 measured findings and no extras.
6. good-ui. PASS. `fitroom scopes` in bad-ui and good-ui printed the same 7 groups and routes. Every good-ui group returned `Automated findings: 0.`
7. Flags. PASS. `--pages /login,/signup` captured only those two pages. Running the CLI outside an app folder with no dev server printed a plain error and no stack. Running it inside bad-ui with no dev server printed the start the app or pass `--url` message.
8. Broken element. PASS. The check-error page produced three findings and a `Checks that hit errors` line for the unmapped axe rule. The audit finished and wrote both reports.

## Failures found

### Failure 1: `fitroom scopes` printed `1 pages`

Symptom: `fitroom scopes` printed `(1 pages)` for onboarding, app screens, settings and checkout.

Root cause: `scopeText` in `packages/cli/src/scopes.ts` always used the word `pages` and did not handle a count of one.

Test added: `lists one page groups with singular page text` in `packages/cli/test/audit.test.ts`.

The test failed first:

```text
AssertionError: expected 'Available scopes:\n- marketing: Marke…' to contain '(1 page)'
Received: "- onboarding: Onboarding (1 pages): /onboarding"
```

Fix: Added `pageCountLabel` in `packages/cli/src/scopes.ts` and used it in `scopeText`.

Files changed:
- `packages/cli/src/scopes.ts`
- `packages/cli/test/audit.test.ts`

Proof it now passes:

```text
✓ test/audit.test.ts (12 tests) 16339ms
Test Files  1 passed (1)
Tests  12 passed (12)
```

```text
Available scopes:
- marketing: Marketing (2 pages): / /pricing
- auth: Authentication (2 pages): /login /signup
- onboarding: Onboarding (1 page): /onboarding
- dashboard: Dashboard (2 pages): /analytics /dashboard
- app: App screens (1 page): /reports
- settings: Settings (1 page): /settings
- checkout: Checkout (1 page): /checkout
```

Build proof after the fix:

```text
$ grep -n 'pageCountLabel' packages/cli/dist/index.js
27:function pageCountLabel(count) {
980:function pageCountLabel2(count) {
```

## Evidence

Help:

```text
Command options:
  --url <url>       Set the app URL for audit or board.
  --scope <scope>   Use a saved page group.
  --pages <pages>   Use pages separated by commas for audit.
```

Picker:

```text
[ ] 1. Marketing (2 pages): / /pricing
[ ] 2. Authentication (2 pages): /login /signup
[ ] 3. Onboarding (1 page): /onboarding
[ ] 4. Dashboard (2 pages): /analytics /dashboard
[ ] 5. App screens (1 page): /reports
[ ] 6. Settings (1 page): /settings
[ ] 7. Checkout (1 page): /checkout
Select a page group by number.
```

Finding validation:

```text
Scopes checked: 7
Measured findings: 7
Expected bugs found: 7 of 7
Findings JSON validation passed.
```

Broken element:

```text
Automated findings: 3.
Checks that hit errors:
- /check-error: axe:summary-name on summary. No citation registered for axe rule summary-name.
Findings JSON: /private/tmp/fr-round2-check-error/.fittingroom/audits/app/findings.json
HTML report: /private/tmp/fr-round2-check-error/.fittingroom/audits/app/report.html
```

Full logs are in `test-reports/logs/round-2/`.

Screenshots: none in this round because Round 2 is CLI and terminal checks only.

## Needs Joseph

None.
