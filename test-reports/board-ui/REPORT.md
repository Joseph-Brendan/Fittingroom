# Board UI redesign

## Outcome

The board is now flat, responsive and readable at 375, 768, 1280 and 1440 pixels. It has a side panel on desktop, a drawer on tablet, a bottom sheet on phone, light and dark themes, a collapsed Previous strip and a clear selected and pinned state on every card.

All board behavior stays the same. The board still uses the same state, API, WebSocket messages, edit log, file formats and MCP and CLI paths. The scope pill, tabs, dialogs and card actions keep their test-facing names.

## Before and after

Before is light only because the old board had no dark theme. After has light and dark at every width. Click a cell to open the screenshot.

| State | Theme | 375 | 768 | 1280 | 1440 |
| --- | --- | --- | --- | --- | --- |
| Empty board | Before | [view](before/empty-375.png) | [view](before/empty-768.png) | [view](before/empty-1280.png) | [view](before/empty-1440.png) |
| Empty board | After light | [view](after/empty-light-375.png) | [view](after/empty-light-768.png) | [view](after/empty-light-1280.png) | [view](after/empty-light-1440.png) |
| Empty board | After dark | [view](after/empty-dark-375.png) | [view](after/empty-dark-768.png) | [view](after/empty-dark-1280.png) | [view](after/empty-dark-1440.png) |
| Waiting | Before | [view](before/waiting-375.png) | [view](before/waiting-768.png) | [view](before/waiting-1280.png) | [view](before/waiting-1440.png) |
| Waiting | After light | [view](after/waiting-light-375.png) | [view](after/waiting-light-768.png) | [view](after/waiting-light-1280.png) | [view](after/waiting-light-1440.png) |
| Waiting | After dark | [view](after/waiting-dark-375.png) | [view](after/waiting-dark-768.png) | [view](after/waiting-dark-1280.png) | [view](after/waiting-dark-1440.png) |
| Cards | Before | [view](before/cards-375.png) | [view](before/cards-768.png) | [view](before/cards-1280.png) | [view](before/cards-1440.png) |
| Cards | After light | [view](after/cards-light-375.png) | [view](after/cards-light-768.png) | [view](after/cards-light-1280.png) | [view](after/cards-light-1440.png) |
| Cards | After dark | [view](after/cards-dark-375.png) | [view](after/cards-dark-768.png) | [view](after/cards-dark-1280.png) | [view](after/cards-dark-1440.png) |
| Selected | Before | [view](before/selected-375.png) | [view](before/selected-768.png) | [view](before/selected-1280.png) | [view](before/selected-1440.png) |
| Selected | After light | [view](after/selected-light-375.png) | [view](after/selected-light-768.png) | [view](after/selected-light-1280.png) | [view](after/selected-light-1440.png) |
| Selected | After dark | [view](after/selected-dark-375.png) | [view](after/selected-dark-768.png) | [view](after/selected-dark-1280.png) | [view](after/selected-dark-1440.png) |
| Editor | Before | [view](before/editor-375.png) | [view](before/editor-768.png) | [view](before/editor-1280.png) | [view](before/editor-1440.png) |
| Editor | After light | [view](after/editor-light-375.png) | [view](after/editor-light-768.png) | [view](after/editor-light-1280.png) | [view](after/editor-light-1440.png) |
| Editor | After dark | [view](after/editor-dark-375.png) | [view](after/editor-dark-768.png) | [view](after/editor-dark-1280.png) | [view](after/editor-dark-1440.png) |
| Structure | Before | [view](before/structure-375.png) | [view](before/structure-768.png) | [view](before/structure-1280.png) | [view](before/structure-1440.png) |
| Structure | After light | [view](after/structure-light-375.png) | [view](after/structure-light-768.png) | [view](after/structure-light-1280.png) | [view](after/structure-light-1440.png) |
| Structure | After dark | [view](after/structure-dark-375.png) | [view](after/structure-dark-768.png) | [view](after/structure-dark-1280.png) | [view](after/structure-dark-1440.png) |
| Findings | Before | [view](before/findings-375.png) | [view](before/findings-768.png) | [view](before/findings-1280.png) | [view](before/findings-1440.png) |
| Findings | After light | [view](after/findings-light-375.png) | [view](after/findings-light-768.png) | [view](after/findings-light-1280.png) | [view](after/findings-light-1440.png) |
| Findings | After dark | [view](after/findings-dark-375.png) | [view](after/findings-dark-768.png) | [view](after/findings-dark-1280.png) | [view](after/findings-dark-1440.png) |
| Previous | Before | [view](before/previous-375.png) | [view](before/previous-768.png) | [view](before/previous-1280.png) | [view](before/previous-1440.png) |
| Previous | After light | [view](after/previous-light-375.png) | [view](after/previous-light-768.png) | [view](after/previous-light-1280.png) | [view](after/previous-light-1440.png) |
| Previous | After dark | [view](after/previous-dark-375.png) | [view](after/previous-dark-768.png) | [view](after/previous-dark-1280.png) | [view](after/previous-dark-1440.png) |
| Toast | Before | [view](before/toast-375.png) | [view](before/toast-768.png) | [view](before/toast-1280.png) | [view](before/toast-1440.png) |
| Toast | After light | [view](after/toast-light-375.png) | [view](after/toast-light-768.png) | [view](after/toast-light-1280.png) | [view](after/toast-light-1440.png) |
| Toast | After dark | [view](after/toast-dark-375.png) | [view](after/toast-dark-768.png) | [view](after/toast-dark-1280.png) | [view](after/toast-dark-1440.png) |
| Approved | Before | [view](before/approved-375.png) | [view](before/approved-768.png) | [view](before/approved-1280.png) | [view](before/approved-1440.png) |
| Approved | After light | [view](after/approved-light-375.png) | [view](after/approved-light-768.png) | [view](after/approved-light-1280.png) | [view](after/approved-light-1440.png) |
| Approved | After dark | [view](after/approved-dark-375.png) | [view](after/approved-dark-768.png) | [view](after/approved-dark-1280.png) | [view](after/approved-dark-1440.png) |
| Connected | Before | [view](before/connected-375.png) | [view](before/connected-768.png) | [view](before/connected-1280.png) | [view](before/connected-1440.png) |
| Connected | After light | [view](after/connected-light-375.png) | [view](after/connected-light-768.png) | [view](after/connected-light-1280.png) | [view](after/connected-light-1440.png) |
| Connected | After dark | [view](after/connected-dark-375.png) | [view](after/connected-dark-768.png) | [view](after/connected-dark-1280.png) | [view](after/connected-dark-1440.png) |

### Old empty and waiting fixtures

The old board also has empty and waiting captures from the bad-ui fixture at all four widths.

| State | 375 | 768 | 1280 | 1440 |
| --- | --- | --- | --- | --- |
| Empty board | [view](before/bad-ui-empty-375.png) | [view](before/bad-ui-empty-768.png) | [view](before/bad-ui-empty-1280.png) | [view](before/bad-ui-empty-1440.png) |
| Waiting | [view](before/bad-ui-waiting-375.png) | [view](before/bad-ui-waiting-768.png) | [view](before/bad-ui-waiting-1280.png) | [view](before/bad-ui-waiting-1440.png) |

## What was broken

1. The header was a two-line display title at 375 and a large block at 1280. It pushed the cards and controls down and left no room for the page group.
2. The 768 findings view was an overlay. It covered the cards, the top bar and the disabled actions.
3. The 1280 board had no side panel. The inspector and information design sat below the cards, and the Previous strip was always open.
4. The preview iframes were not scaled. Card content was clipped and some previews showed a scrollbar.
5. The old board had one beige theme. Dark mode did not exist, and the surfaces used heavy borders, black pills and mixed control styles.
6. Card state was split between a black Pinned pill, a pin button and a Choose button. There was no selected label and no clear refined state in the header.
7. The Previous strip took a large block under the cards on every width, even when the user did not need it.
8. The 375 empty state had a large title, no top bar, no side panel and a prominent warning above the main action.
9. Controls were small. The top bar, tabs and card actions did not have a consistent touch target, focus ring or keyboard path.
10. The old toast was a small dark bar with no consistent position, close control or four second timer.

## What changed

- `tokens.css` now holds every color, font, space, radius, motion and layer value. Light and dark use the same names.
- `ui.tsx` now holds shared buttons, icon buttons, tabs, pills, toast, skeleton and stroke icons. The icon set uses 16 and 20 pixel sizes with a 1.5 stroke.
- The top bar is 56 pixels on desktop. Tablet and phone wrap it into two rows. The scope control, viewport switch, regenerate, approve, findings and panel controls stay reachable at every width.
- Desktop has a 360 pixel side panel. Tablet has a 400 pixel drawer. Phone has an 85 percent height bottom sheet. The panel tabs are Inspector, Structure and Findings.
- Cards are a 2 by 2 grid at 768 and wider and one column at 375. The preview scales to the card width. Full size, pin, regenerate and choose actions stay on the card.
- Cards show a compact Selected or Pinned pill. The selected card uses the accent border. The Refined card keeps the exact `Your design, refined.` label and the same rationale text.
- The Previous strip starts closed, opens with `Show previous rounds` and keeps the same round snapshots and restore behavior.
- The toast stack sits above the bottom edge, closes by button and hides after four seconds.
- Phone controls are at least 44 by 44 pixels. The phone viewport switch is a select. Tablet and phone card headers use a compact state pill and a smaller header gap.
- Keyboard support covers arrow key card movement, Enter to select, Escape to close panels and dialogs, and focus return to the trigger.
- Reduced motion removes the animations. Flat style checks confirm no shadows, gradients, text shadows, filters or backdrop filters. Tooltips use native browser `title` attributes so they cannot add page overflow.

## Behavior and copy kept

- The empty state keeps `No directions yet.` and the exact instruction line.
- The waiting state keeps `Waiting for your agent.` and the exact agent request line.
- The design system banner keeps the exact connected, partial and not found copy.
- The old board tests still use `data-testid="variant-card"`, the `Choose` and `Regenerate` labels, `Findings (3)`, the inspector labels and the page group control.
- The Previous strip test now opens the strip first because the strip starts closed.
- The board still serves only on `127.0.0.1` and keeps the session token on every request.

## Accessibility and audit

- No axe violations in the 11 visual states in light and dark at 1280 pixels.
- No horizontal overflow at any width from 320 to 1920 pixels.
- Every phone control meets the 44 by 44 pixel target.
- The board dogfood audit ran with `runAutomatedChecks` at 1440 by 900. It reports 0 errors and 0 measured findings.
- The same audit returns 10 judged `contrast-unmeasured` items. Axe could not compute a background through the card iframes, because an element overlaps another, or because the input has no value. The crops are in `dogfood/` and the full report is `dogfood-audit.json`.
- The 10 judged items are not measured failures. The axe AA suite reports no violations, and the crops show readable text on solid surfaces. The measured audit is clean.
- The 320 check is the overflow test, because the core audit opens a fixed 1440 viewport.

## Tests

| Command | Result |
| --- | --- |
| `pnpm lint` | Pass, 6 warnings (`noImportantStyles` in reduced motion and descending specificity in phone selectors) |
| `pnpm typecheck` | Pass, all 6 packages |
| `pnpm test` | Pass, 36 files and 196 tests |
| `pnpm build` | Pass, all 6 packages |
| `pnpm test:e2e` | Pass, 31 tests in 7.0 minutes |
| `pnpm link --global` | Pass, `fitroom --help` works |

The 196 unit tests are 11 citations, 5 directions, 3 board, 118 core, 21 MCP and 38 CLI.

## Dogfood details

`dogfood-audit.json` records 0 errors, 0 measured findings and 10 judged contrast items. The items are:

- Four card rationale lines. Axe could not read a background through the card iframe.
- The `Try another direction` label.
- The direction input placeholder.
- The Send request button label.
- The Live sync connected line.
- The Live sync connected strong text.
- The panel empty state paragraph.

## Files changed

- `packages/board/src/App.tsx`: responsive shell, cards, tabs, panel, Previous strip, toast and keyboard behavior.
- `packages/board/src/Inspector.tsx`: inspector content in the new panel.
- `packages/board/src/styles.css`: flat visual system, themes, breakpoints, focus and touch rules.
- `packages/board/src/tokens.css`: design tokens for both themes.
- `packages/board/src/ui.tsx`: shared controls and icons.
- `e2e/board-ui.spec.ts`: 88 visual baselines, overflow, flat style, axe, keyboard, touch, panel, state and toast tests.
- `e2e/ui-board-server.mts`: four board fixtures on ports 4180 to 4183.
- `e2e/board.spec.ts` and `e2e/board-bridge.spec.ts`: old tests updated for the card test id and the closed Previous strip.
- `playwright.config.ts`: board UI fixtures and the visual baseline path.
- `.gitignore`: generated board session files.
- `.changeset/flat-responsive-board.md`: minor changeset for the board redesign.
- `test-reports/board-ui/before/`: 52 before screenshots and manifest.
- `test-reports/board-ui/after/`: 88 after screenshots and manifest.
- `test-reports/board-ui/baselines/`: 88 visual baselines.
- `test-reports/board-ui/dogfood/`: 10 audit crops.
- `test-reports/board-ui/dogfood-audit.json`: final audit report.
- `test-reports/board-ui/REPORT.md`: this report.

## Not done

- The scope pill shows `Working on: Authentication`. It does not show a page count. Board state does not expose the page count, and adding it would change the board data flow, API and file format.
- The audit still returns 10 judged contrast items because axe cannot measure through iframes, overlaps or the empty input. I did not hide them. The measured checks are clean.

## Reproduce

```bash
pnpm build
pnpm test:e2e
```

The visual baselines are compared by default. To regenerate them on purpose:

```bash
pnpm exec playwright test e2e/board-ui.spec.ts --grep "captures every state" --update-snapshots=all
```

To rerun the board audit, start the UI fixture and point `runAutomatedChecks` at its session URL. The fixture command is `BOARD_UI_PORT=4190 pnpm exec tsx e2e/ui-board-server.mts`.
