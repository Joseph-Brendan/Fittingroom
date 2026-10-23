# Round 3: The board in a real browser

## Result

FAIL. The board starts and the empty state works. The MCP to board bridge is not built, so the real board cannot show directions, accept edits, or approve a direction. Items marked BLOCKED need product work.

## What I tested

1. Delete `.fittingroom` and start the board. PASS. `fitroom board --url http://localhost:3000` started on `http://127.0.0.1:4173` and created `board.json`, `history.json` and `scopes.json`. No ENOENT and no crash.
2. Browser address and token. PASS. The address started with `http://127.0.0.1` and included `token=`. A request without the token returned 401.
3. Header, banner and empty state. PASS. The header showed Marketing. The picker listed Marketing, Authentication, Onboarding, Dashboard, App screens, Settings and Checkout. The banner said `Design system not found. Edits will create a new token set you can adopt later.` The page showed `No directions yet.` and `Run an audit and generate directions, or click Generate directions.` with a Generate directions button.
4. Generate 4 directions through MCP and show them on the board. FAIL and BLOCKED. `fr_directions` returned 4 slots for `/`: Refined, Swiss / International, Neubrutalism and Art Deco. The board state stayed at 0 variants. No code writes the MCP directions to `board.json`, and the board server has no update endpoint for new variants or previews.
5. Switch between 375, 768 and 1440 px. PASS for the board UI with the e2e board state. Screenshots were taken at all three widths. The real board cannot show cards because item 4 is blocked.
6. Regenerate all five times. PASS for the core regeneration logic through MCP. Slot 1 stayed `refined` with `directionSlug` null every round. Slots 2 to 4 used new directions each round. FAIL for the board end to end because item 4 is blocked.
7. Pin, regenerate one card, and restore a previous round. FAIL and BLOCKED. The e2e board harness supports pin and single-card regenerate. The real `runBoardCommand` configures only regenerate and pin, not restore. The Previous strip displays past rounds but has no restore control or API.
8. Editor actions. FAIL and BLOCKED. The e2e board harness passes edit, undo, delete, duplicate, insert and reorder. The real board command does not configure edit or undo, so the real `/api/edit` and `/api/undo` endpoints return 501. The real board does not write variant code or `.fittingroom/edits.json` from the editor.
9. Information design panel and `structure.json`. FAIL and BLOCKED. There is no information design panel and no `structure.json` writer or reader in the board.
10. Findings drawer. PASS for the e2e board UI. The drawer grouped findings by severity and linked citations. FAIL for the real board because MCP findings are not written to `board.json`.
11. Repeat steps 1 to 5 on shop-app. PARTIAL. After a fix, the shop-app board banner said `Design system connected: Tailwind v4 @theme, shadcn/ui.` The directions, cards and inspector are blocked by item 4. The e2e inspector with a connected design system passes, and the core off-system flag test passes.

## Failures found

### Failure 1: The board showed "not found" for a connected design system

Symptom: The shop-app board showed `Design system not found` even though `detectDesignSystem` reported `connected` with Tailwind v4 and shadcn/ui.

Root cause: `runBoardCommand` did not detect the design system. It used only the `designSystem` field in `board.json`, which was missing.

Test added: `shows a connected design system for a connected app` in `packages/cli/test/board.test.ts`.

Fix: `runBoardCommand` now detects the design system when the board state has none and adds a summary, tokens and components to the in-memory board state. It does not overwrite `board.json`.

Files changed:
- `packages/cli/src/board-command.ts`
- `packages/cli/test/board.test.ts` (new)

Proof: The test passes. The shop-app board now shows `Design system connected: Tailwind v4 @theme, shadcn/ui.`

Screenshot: `test-reports/screenshots/round-3/shop/board-empty.png`

### Failure 2: MCP directions do not reach the board

Status: BLOCKED.

Evidence: `fr_directions` returned 4 slots. The board API reported `variants: 0`. The code has no bridge from the MCP tool to `board.json` or to a running board server.

Command output is in `test-reports/logs/round-3/fr-round3-mcp-board.log`. The key line is `Board variants: 0` while `Directions slots: 1:refined:Refined | 2:native:Swiss / International | 3:bold:Neubrutalism | 4:wildcard:Art Deco`.

This blocks steps 4, 5, 6, 7, 8 and 10 for the real board.

### Failure 3: The real board editor is not wired

Status: BLOCKED.

Evidence: `runBoardCommand` passes `regenerate` and `pin` to `startBoardServer` but no `edit` or `undo` callbacks. The server returns 501 for `/api/edit` and `/api/undo`.

This blocks step 8 on the real board.

### Failure 4: Restore from a previous round is missing

Status: BLOCKED.

Evidence: The board App renders the Previous strip but has no restore action. The server has no restore endpoint.

This blocks part of step 7.

### Failure 5: Information design panel and structure.json are missing

Status: BLOCKED.

Evidence: There is no information design panel. No source file reads or writes `.fittingroom/structure.json`.

This blocks step 9.

## Evidence

Empty board JSON:

```text
scope: marketing
scopes: 7 groups
variants: []
findings: []
previousRounds: []
```

Browser check:

```text
address: http://127.0.0.1:4173/?token=...
startsWithLocalhost: true
tokenized: true
refusedStatus: 401
selected: marketing
banner: Design system not found. Edits will create a new token set you can adopt later.
title: No directions yet.
copy: Run an audit and generate directions, or click Generate directions.
```

Shop-app banner after the fix:

```text
banner: Design system connected: Tailwind v4 @theme, shadcn/ui.
```

Regeneration logic:

```text
Round 1: slot1=refined/null slots2to4=swiss-international,neubrutalism,scrapbook-hand-drawn
Round 2: slot1=refined/null slots2to4=editorial,memphis,claymorphism
Round 3: slot1=refined/null slots2to4=type-first,dopamine,retro-y2k
Round 4: slot1=refined/null slots2to4=bento-grid,cyberpunk,art-deco
Round 5: slot1=refined/null slots2to4=monochrome,bauhaus,aurora-mesh
Slot 1 always refined: yes
Repeated directions: none
```

Screenshots:
- `test-reports/screenshots/round-3/board-empty.png`
- `test-reports/screenshots/round-3/shop/board-empty.png`
- `test-reports/screenshots/round-3/e2e/board-1440.png`
- `test-reports/screenshots/round-3/e2e/board-375.png`
- `test-reports/screenshots/round-3/e2e/board-768.png`
- `test-reports/screenshots/round-3/e2e/board-findings.png`

## Needs Joseph

- Decide and implement the MCP to board bridge: how directions, variants, previews and findings reach a running board.
- Decide the approval flow for a chosen direction.
- Decide the editor and information design panel behavior, including the `structure.json` format.
- Decide how restoring an earlier round should work.

The editor and structure work are product behavior decisions, not test fixes.
