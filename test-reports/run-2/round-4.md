# Round 4: the full loop through MCP

## Result

PASS on shop-app and metrics-dashboard.

## Shop-app, authentication group

1. MCP from inside shop-app. PASS. `fitroom mcp` started in the app folder and selected `/login`.
2. Audit. PASS. 4 measured target size findings on `/signup`, all `wcag22-2.5.8`.
3. Heuristic review. PASS. One judged finding: `Login has no recovery path`, citation `nielsen-h9`, severity 2.
4. Directions through the board. PASS. The board generated a request and the agent returned four directions.
5. Register four variants. PASS. Refined, Clean UI, Dark-First and Spatial were accepted.
6. Two edits. PASS. The heading color changed to `#ff00ff` with `offSystem: true`, then the heading text changed to `Welcome back to Northwind`.
7. Information design change. PASS. Density changed to sparse.
8. Approval. PASS. Refined in slot 1.
9. Handoff. PASS. `handoff-b411d0b7`.
10. Implement. PASS. The real `/login` page imports the approved refined variant. Input styles were made explicit so the real page and preview agree.
11. Verify. PASS. 27 regions, 0 failing, 0 style mismatches, 0 structure mismatches.
12. Wrong build. PASS. The wrong variant failed verify on 8 regions.

## Metrics-dashboard, dashboard group

1. MCP from inside metrics-dashboard. PASS. `fitroom mcp` started in the app folder and selected `/dashboard`.
2. Audit. PASS. 4 measured target size findings on `/analytics`, all `wcag22-2.5.8`.
3. Heuristic review. PASS. One judged finding: `Dashboard does not show when the data was last updated`, citation `nielsen-h1`, severity 2.
4. Directions through the board. PASS. Four directions were returned.
5. Register four variants. PASS. Refined, Data-Dense Utilitarian, Command Center and Widget Bento Dashboard were accepted.
6. Two edits. PASS. The heading text changed to `Team dashboard`, then the heading size changed to `44px`.
7. Information design change. PASS. Density changed to dense.
8. Approval. PASS. Refined in slot 1.
9. Handoff. PASS. `handoff-0a03f9ed`.
10. Implement. PASS. The real `/dashboard` page imports the approved refined variant.
11. Verify. PASS. 27 regions, 0 failing, 0 style mismatches, 0 structure mismatches.
12. Wrong build. PASS. The wrong variant failed verify on 5 regions.
13. Design memory. PASS. `fr_design_memory` returned both files. The dashboard matched its memory with 0 findings. The next page in the scope, `/analytics`, had 3 design memory findings: 2 spacing, 1 font size.
14. States check. PASS. Empty, loading and error were not reachable because the page makes no API calls. Long text passed. Dark mode passed.

## Evidence

Shop-app:

```text
audit: 4 measured findings
judged: 1
handoff: handoff-b411d0b7
verify: passed
verify wrong build: failed
```

Metrics-dashboard:

```text
audit: 4 measured findings
judged: 1
handoff: handoff-0a03f9ed
verify: passed
verify wrong build: failed
design memory on /dashboard: 0 findings
design memory on /analytics: 3 findings
states: empty not reachable, loading not reachable, error not reachable, long pass, dark pass
```

Screenshots:
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

Logs:
- `test-reports/run-2/logs/round-4/shop-audit-auth.json`
- `test-reports/run-2/logs/round-4/shop-judged.json`
- `test-reports/run-2/logs/round-4/shop-handoff.json`
- `test-reports/run-2/logs/round-4/shop-verify.json`
- `test-reports/run-2/logs/round-4/shop-verify-wrong.json`
- `test-reports/run-2/logs/round-4/shop-design-memory.json`
- `test-reports/run-2/logs/round-4/metrics-audit-dashboard.json`
- `test-reports/run-2/logs/round-4/metrics-judged.json`
- `test-reports/run-2/logs/round-4/metrics-handoff.json`
- `test-reports/run-2/logs/round-4/metrics-verify.json`
- `test-reports/run-2/logs/round-4/metrics-verify-wrong.json`
- `test-reports/run-2/logs/round-4/metrics-design-memory-audit.json`
- `test-reports/run-2/logs/round-4/metrics-design-memory.json`
- `test-reports/run-2/logs/round-4/metrics-states.json`

## Failures found and fixed

1. Handoff used the preview reference from registration, not the current variant after board edits. Test added: `renders the current variant file before writing the handoff`. Fix: `fr_handoff` re-renders the current variant before writing.
2. Verify failed on the real apps because style tags were treated as design elements, and inherited border colors were compared. Tests added: `ignores style elements in the handoff style map` and `does not fail on inherited border colors`. Fix: style, script, link and meta elements are skipped, and border color inherited differences are not compared.
3. Design memory used direction defaults instead of the approved variant. Test added to the handoff freshness test. Fix: memory now reads the approved variant reference for colors, fonts, sizes, spacing, radii and the button and input styles.
4. The shop-app input color and background differed between preview and real page. Fix: the approved variant sets explicit input background, color and line height.

## Needs Joseph

None.
