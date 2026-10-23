# Round 4: The full loop through MCP

## Result

FAIL. The core MCP loop works on both real apps and both end in a verify pass. The board approval flow, design memory and states check are not built, so those steps are BLOCKED.

## What I tested

1. List the tools. FAIL. The server exposes `fr_scopes`, `fr_capture`, `fr_audit`, `fr_slop`, `fr_directions`, `fr_regenerate`, `fr_register_variant`, `fr_handoff`, `fr_verify` and `fr_submit_findings`. `fr_design_memory` and `fr_states` are missing. `fr_slop` was added during this round.
2. `fr_scopes` and pick a group. PASS. shop-app returned marketing, auth and settings. metrics-dashboard returned marketing, dashboard and app. The selected groups were auth for shop-app and dashboard for metrics-dashboard.
3. `fr_audit`, heuristic review and `fr_submit_findings`. PASS. shop-app auth returned 8 automated findings and metrics-dashboard returned 9. The critique brief included page screenshots. A made-up `nielsen-h99` citation was rejected. Valid judged findings were accepted.
4. Bugs 8 to 10 on bad-ui. PASS. Settings accepted `nielsen-h5` and `nielsen-h1`. Dashboard accepted `nielsen-h2`. Counts were 2 judged and 1 judged.
5. `fr_directions`, write 4 variants, register them. PASS. Four variants were accepted on shop-app and four on metrics-dashboard. A variant that does not render was rejected. A shop-app variant that adds new contrast failure was rejected. A metrics variant with a missing image alt was rejected.
6. Open the board, pick a direction, make 2 edits and approve it. FAIL and BLOCKED. The board is not connected to the MCP variant state. There is no approval action.
7. `fr_handoff` folder. PASS after a fix. The folder now has the variant source, reference screenshots at 375, 768 and 1440, `tokens.json`, `structure.json`, `edits.json`, `findings-fixed.json`, `checklist.md` and `brief.md`.
8. Implement the handoff and call `fr_verify`. PASS on both apps. shop-app `/login` and metrics-dashboard `/dashboard` were implemented from the accepted variants. Both verifies passed with 0.00 percent pixel difference in every region and zero token or order mismatches. A deliberately wrong shop-app implementation failed, then the good implementation was restored and passed again.
9. Design memory and `DESIGN.md`. FAIL and BLOCKED. There is no design memory tool and no `DESIGN.md` writer.
10. States check. FAIL and BLOCKED. There is no states tool and no capture for empty, loading, error, long text or dark mode.
11. Slop check. PASS. shop-app score was 0 with 0 rules. metrics-dashboard score was 12 with 1 rule. Both 1200 by 630 score card PNGs were saved.

## Failures found and fixed

### Failure 1: Findings from different pages shared the same id

Symptom: shop-app auth returned 8 automated findings and 1 judged finding, but `fr_submit_findings` reported `total: 5`.

Root cause: `runAutomatedChecks` gives ids such as `target-size-1` per page. The MCP merged findings by `id`, so findings from `/login` and `/signup` overwrote each other.

Test added: `gives findings with the same check id on different pages unique ids` in `packages/core/test/audit.test.ts`.

Fix: Added `findingIdForPage` and prefixed finding ids with the page. The CLI and MCP both use it.

Files changed:
- `packages/core/src/audit.ts`
- `packages/core/test/audit.test.ts`
- `packages/cli/src/audit.ts`
- `packages/mcp/src/server.ts`

Proof: shop-app now reports `automated: 8, judged: 1, total: 9`. metrics-dashboard reports `automated: 9, judged: 1, total: 10`.

### Failure 2: The MCP server audited the wrong app when several dev servers ran

Symptom: With bad-ui on 3000, shop-app on 3100 and metrics-dashboard on 3200, the MCP server from shop-app or metrics-dashboard could pick port 3000.

Root cause: `detectDevServer` checked a fixed port list and returned the first running app. It ignored the project folder.

Test added: `finds the dev server port declared in the project dev script` in `packages/core/test/dev-server.test.ts`.

Fix: Added `detectProjectDevServer`. It reads the `dev` script in the app `package.json`, extracts the port and checks only that port. The CLI audit and the MCP server use it.

Files changed:
- `packages/core/src/dev-server.ts`
- `packages/core/test/dev-server.test.ts`
- `packages/cli/src/audit.ts`
- `packages/mcp/src/server.ts`

Proof: shop-app used 3100 and metrics-dashboard used 3200 for every audit and verify.

### Failure 3: The handoff folder was missing required files

Symptom: `fr_handoff` wrote only `handoff.json`, `brief.md`, `reference` and `source`.

Root cause: `writeHandoff` did not write the token, structure, edit, fixed finding or checklist files.

Test added: `writes tokens, structure, edits, fixed findings and the checklist` in `packages/core/test/verify.test.ts`.

Fix: `writeHandoff` now writes `tokens.json`, `structure.json`, `edits.json`, `findings-fixed.json` and `checklist.md`. The MCP handoff passes the project edits log and the fixed findings.

Files changed:
- `packages/core/src/handoff.ts`
- `packages/core/test/verify.test.ts`
- `packages/mcp/src/server.ts`

Proof: The handoff folder now contains `brief.md, checklist.md, edits.json, findings-fixed.json, handoff.json, reference, source, structure.json, tokens.json`.

### Failure 4: There was no slop tool

Symptom: The tools list had no slop tool, so the agent could not check slop or save a score card.

Root cause: The core had `detectSlop` and `renderSlopScoreCard`, but the MCP server did not expose them.

Test added: `returns a slop score and saves a 1200 by 630 score card` in `packages/mcp/test/tools.test.ts`.

Fix: Added the `fr_slop` MCP tool.

Files changed:
- `packages/mcp/src/server.ts`
- `packages/mcp/test/tools.test.ts`

Proof: shop-app score 0, metrics-dashboard score 12, both score card PNGs saved at 1200 by 630.

## Failures found and blocked

### Board approval flow

The board does not read MCP variants and there is no approve action. This needs a product decision and a bridge.

### Design memory

There is no `fr_design_memory` tool and no `.fittingroom/DESIGN.md`. The flagging rules for a new page need a product decision.

### States check

There is no `fr_states` tool and no empty, loading, error, long text or dark mode capture. The trigger and pass rules need a product decision.

## Evidence

Tools:

```text
fr_scopes, fr_capture, fr_audit, fr_slop, fr_directions, fr_regenerate, fr_register_variant, fr_handoff, fr_verify, fr_submit_findings
Missing expected tools: fr_design_memory, fr_states
```

shop-app:

```text
Automated findings: 8
Invalid citation rejected: true
Submitted counts: {"automated":8,"judged":1,"total":9}
Directions surface: app
Slop score: 0
```

metrics-dashboard:

```text
Automated findings: 9
Invalid citation rejected: true
Submitted counts: {"automated":9,"judged":1,"total":10}
Directions surface: dashboard
Slop score: 12
```

Variants:

```text
refined: accepted=true
native: accepted=true
bold: accepted=true
wildcard: accepted=true
bad-render: accepted=false
bad-contrast: accepted=false
bad-image: accepted=false
```

Verify:

```text
shop-app /login:
Passed: true
Region diffs: all 0.00%
Token mismatches: 0
Order mismatches: 0

metrics-dashboard /dashboard:
Passed: true
Region diffs: all 0.00%
Token mismatches: 0
Order mismatches: 0

shop-app wrong implementation:
Passed: false
```

Screenshots:
- `test-reports/screenshots/round-4/shop-login-375.png`
- `test-reports/screenshots/round-4/shop-login-768.png`
- `test-reports/screenshots/round-4/shop-login-1440.png`
- `test-reports/screenshots/round-4/shop-login-wrong-1440.png`
- `test-reports/screenshots/round-4/metrics-dashboard-375.png`
- `test-reports/screenshots/round-4/metrics-dashboard-768.png`
- `test-reports/screenshots/round-4/metrics-dashboard-1440.png`
- `test-reports/screenshots/round-4/shop-slop-score.png`
- `test-reports/screenshots/round-4/metrics-slop-score.png`

Logs are in `test-reports/logs/round-4/`.

## Needs Joseph

- Define the board approval flow and the MCP to board bridge.
- Define design memory: what `DESIGN.md` contains and what counts as breaking the saved design.
- Define the states check: how to trigger each state and what counts as a pass.
- Confirm the MCP server entry point. The round instruction named `dist/index.js`, but that file is the library entry. The server entry is `dist/bin.js` and the package bin `fittingroom-mcp`. I used the bin and added README start instructions.
