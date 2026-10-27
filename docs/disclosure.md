# Fitroom: cited UI audits and editable redesign directions for AI coding agents

## Purpose and shape

Fitroom is a local tool for coding agents and the people supervising them. It captures one page group from a running app, audits that group, attaches an approved citation to every finding, asks the agent to build four redesign directions, and shows those directions as editable code on a local board. After the user picks a direction, Fitroom writes a handoff and later checks the agent's real implementation against it.

The code is split into six packages. `packages/core` holds capture, audit, design system detection, edit operations, board state, design memory, state checks, handoff and verify. `packages/citations` holds the registry and validators. `packages/directions` holds the direction schema, slot specs and named direction library. `packages/mcp` exposes the core over stdio. `packages/board` is the Vite and React board. `packages/cli` provides the `fitroom` command.

Everything runs inside the user's project. Nothing goes to a remote service. The board binds to `127.0.0.1` and requires a random session token on every HTTP and WebSocket request. The registry and direction JSON are imported at build time, so the published CLI has no cross-package runtime reads.

## Citation registry and validator

Every audit finding must carry a citation ID from `packages/citations/registry.json`. The registry has version 1 and an array of citations. Each citation has `id`, `source`, `criterion`, `title`, `url`, `version` and `level`. The current registry has 73 entries across WCAG 2.2, Nielsen's 10 Usability Heuristics, the NN/g 0 to 4 severity scale, Apple Human Interface Guidelines, Material Design 3, WAI-ARIA Authoring Practices Guide and Project design memory. The source allowlist also names Laws of UX, but no current entry uses it.

`validateCitationRegistry` checks the whole file before use. The registry must be an object with version 1. `citations` must be a non-empty array. Every ID must be lowercase and hyphen separated. Every source must be on the allowlist. Every entry needs a criterion, title, URL, version and a level of `A`, `AA`, `AAA` or `N/A`. IDs must be unique. URLs are checked against an approved host list, with one local exception for `.fitroom/DESIGN.md`. An agent cannot supply an arbitrary URL.

The finding validator, `validate(finding)`, checks the parts that vary at runtime. The primary citation ID must exist in the registry. Every related ID must exist, must not repeat the primary ID and must not be repeated. Evidence must be non-empty text or an object with a selector, screenshot path and measured value. The MCP schema adds the rest of the contract: title, fix, severity from 0 to 4, and `confidence: "judged"` for agent findings. Automated findings are created in code as `measured`.

The finding shape is:

```json
{
  "id": "auth-contrast-1",
  "title": "Text does not meet contrast",
  "citation": "wcag22-1.4.3",
  "related": ["nielsen-h4"],
  "severity": 2,
  "confidence": "measured",
  "evidence": {
    "selector": ".helper",
    "screenshotPath": ".fitroom/audits/auth/login/01.png",
    "measuredValue": "contrast ratio 2.9:1, required 4.5:1"
  },
  "fix": "Use a text color that meets the 4.5:1 minimum."
}
```

`fr_audit` captures one group and runs `runAutomatedChecks` on each page. Axe-core runs the WCAG 2.0 A and AA, WCAG 2.1 A and AA, and WCAG 2.2 AA tags. Every axe rule must have an entry in a hard-coded rule-to-citation map. A rule without a map entry becomes an error, not an uncited finding. Custom checks cover target size, focus visibility, focus not obscured and reflow at 320 CSS pixels. When axe cannot measure contrast, the result becomes a judged contrast finding with a WCAG 2.2 citation. It is never presented as measured.

Findings for the same selector and the same root problem merge. The merged finding keeps the highest severity and lists the other citations as related. The audit returns the findings, any check errors, page screenshots and a critique brief. The brief gives the agent the screenshots, visible controls and text, valid citation IDs and the review instructions. The agent can submit judged findings with `fr_submit_findings`, and those findings must pass the same validator. The final set is automated plus accepted judged findings. The CLI writes findings and an HTML report under `.fitroom/audits/<scope>/` and prints both paths.

## Page groups and one-group capture

Fitroom has seven page groups: `marketing`, `auth`, `onboarding`, `dashboard`, `app`, `settings` and `checkout`. The route grouper reads the app router when possible and falls back to a crawl. It assigns routes by path segments and group aliases. The user can rename, merge or split groups. The saved form is `.fitroom/scopes.json`:

```json
{
  "version": 1,
  "scopes": [
    {
      "id": "auth",
      "name": "Authentication",
      "routes": ["/login", "/signup", "/forgot-password"]
    }
  ]
}
```

The default scope comes from the route last requested by the dev server, then the most recently edited route file, then a checklist for the user. A capture resolves exactly one scope. It never crawls the whole app. The CLI shows this summary before the browser starts:

```text
Capturing: Authentication (3 pages): /login /signup /forgot-password, at 375, 768 and 1440 px.
```

`fr_capture` and `fr_audit` accept a scope or explicit pages. Without either, they use the default scope. If no default exists, they return the checklist instead of guessing.

Capture visits each selected page at 375, 768 and 1440 CSS pixels, with a 900 pixel viewport height. It saves full-page screenshots, the accessibility tree and a slop-evidence file:

```text
.fitroom/captures/<scope>/<page-slug>/
  375.png
  768.png
  1440.png
  accessibility-tree.json
  slop-evidence.json
```

The accessibility tree and slop evidence feed direction briefs and the slop score. The screenshots are the visual evidence for audits, directions and handoff.

## Four design slots and regeneration

The board always has four slots:

| Slot | Role     | Rule                                                    |
| ---- | -------- | ------------------------------------------------------- |
| 1    | Refined  | Always the user's own design, improved in its own style |
| 2    | Native   | A platform or native-pattern direction                  |
| 3    | Bold     | A stronger visual direction                             |
| 4    | Wildcard | A more experimental direction                           |

Slot 1 is locked to Refined. It never receives a library direction. Refined has two modes. `light` fixes audit findings. `deep` also improves spacing, type scale and hierarchy. Both keep the user's layout, brand colors, fonts and style.

`fr_directions` reads the latest audit for a route and returns four briefs. Slot 1 gets Refined. Slots 2 to 4 get named directions that support the page surface. The briefs include screenshots, a content inventory, the detected design system and writing rules. The agent writes the variant code. Fitroom does not generate the source itself.

The seven page groups collapse into three direction surfaces for matching: marketing, app and dashboard. The library declares which surfaces each named direction supports. A direction spec requires a type pair, type scale, radius, border, shadow, color recipe, density, motion, layout rules, do and do not lists, and an accessibility risk note.

`fr_register_variant` accepts the agent's code. It requires a project-local file, a lowercase slug, a rationale and an optional slot. It type-checks the file, stamps every JSX element with a stable `data-fr-id`, saves a stamped baseline copy, renders the variant, screenshots it and audits it. A variant that fails to render or adds a new WCAG AA failure is rejected. Accepted variants are stored on the board with their file and preview paths.

`fr_regenerate` is the round-based change path. It processes slots 1 to 4 in order. Pinned slots are copied forward unchanged. Slot 1 is regenerated only as a new Refined variant, never as a library direction. Its baseline screenshots come from the original capture. Slots 2 to 4 choose directions that support the surface. A direction already seen for the scope is skipped. If every candidate has been seen, the seen set is cleared for that role and selection starts again. The previous round stays in `.fitroom/history.json`, and the board receives a new round with the four slots, rationales and pins.

The board can pin any slot. A pinned slot is not changed by a regenerate, but the user can still edit its code. This lets the user keep one direction while asking for a new round elsewhere.

## Edits as operations on real code

Each variant is a real project file. The board is not a mock. Registration gives every JSX element a stable `data-fr-id` and saves the stamped baseline under `.fitroom/variants/<slug>.orig.tsx`. Each edited variant has a log at `.fitroom/edits/<slug>.json`:

```json
{
  "version": 1,
  "slug": "refined",
  "baseline": "<stamped source>",
  "edits": [
    {
      "operation": {
        "op": "set-token",
        "id": "fr-button-1",
        "property": "backgroundColor",
        "token": "color.accent"
      },
      "timestamp": "2026-10-27T00:00:00.000Z",
      "offSystem": false
    }
  ],
  "redo": []
}
```

The operations are `set-token`, `set-text`, `move`, `delete`, `duplicate`, `insert`, `swap-section`, `group` and `collapse`. `applyVariantEdit` loads the current source, applies one operation with ts-morph, formats the result and writes the file. It appends the operation to the log. The file on disk is the source of truth, and the board preview reloads from it.

Undo removes the last operation, replays the rest from the baseline and writes the exact source again. Redo replays the undone operation. A new edit after an undo clears the redo stack. The log records whether a value is off the design system. Off-system values are allowed but marked `offSystem: true` for the handoff. Moves stay inside one parent, and inserts use the same operation path. The inspector, structure controls and keyboard shortcuts all end at this log.

## The file-based board bridge

The agent and the board are separate processes. Files under `.fitroom` are the contract. The board never runs a model, and the agent never needs the board's port.

The bridge has three files:
- `.fitroom/board.json` holds version 2 state: scope, surface, page, round, status, four variants, findings, previous rounds, selection and approval.
- `.fitroom/requests.json` holds requests with an ID, type, optional slot, scope, round, creation time and completion time. The types are `generate`, `regenerate`, `regenerate-slot` and `approve`.
- `.fitroom/board.lock` holds the live board's process ID, port, session token, URL and creation time. A stale lock is ignored. A live lock is reused instead of starting a second board.

The status order is `empty`, `generating`, `directions_ready`, `approved`, `handoff_created`, `verifying`, `verified` and `verify_failed`.

The board watches `.fitroom` and broadcasts state and request updates over its WebSocket. When the agent writes a variant, the card appears without a reload. When the user clicks Generate, Regenerate or Approve, the board appends a request. The board shows the waiting message and the exact sentence to give the agent.

The MCP tools are `fr_scopes`, `fr_capture`, `fr_audit`, `fr_slop`, `fr_directions`, `fr_regenerate`, `fr_register_variant`, `fr_handoff`, `fr_verify`, `fr_submit_findings`, `fr_states`, `fr_design_memory`, `fr_open_board`, `fr_board_status`, `fr_wait_for_user` and `fr_complete_request`. `fr_open_board` starts the board if no live lock exists. `fr_wait_for_user` waits for an open request or an approval, with a 600 second default. `fr_complete_request` marks a request done.

The local HTTP server exposes board read and write endpoints for the browser. Every route except `/health` requires the session token. Preview routes, assets, the API and the WebSocket use the same check. The user can edit, pin, restore and approve. The agent reads the approval through the files. This is why the board can be closed and restarted without losing the work.

## Design memory

When a design is approved and `fr_handoff` runs, Fitroom saves design memory in two forms:
- `.fitroom/DESIGN.md` is the human-readable record: direction, type pair and scale, colors, spacing, radii, density, primary button, input, do and do not lists.
- `.fitroom/design-memory.json` is the machine-readable version of the same values.

If memory already exists, the old `DESIGN.md` is copied to a dated archive before the new version is written. The memory is built from the approved direction, detected project tokens, reference computed styles, the primary button and input, and the structure density. It reflects the design the user actually approved.

Later audits run `auditDesignMemory` at 1440 pixels. It measures visible elements and skips iframes, video, object, embed and map content. It checks:

| Rule             | Failure condition                                                                     | Severity |
| ---------------- | ------------------------------------------------------------------------------------- | -------- |
| Primary button   | Background, text, font, size, weight, radius or padding differs from the saved button | 3        |
| Text color       | More than 3 Delta E from the nearest saved color                                      | 2        |
| Background color | More than 3 Delta E from the nearest saved color                                      | 2        |
| Border color     | More than 3 Delta E from the nearest saved color                                      | 2        |
| Font family      | Not in the saved type pair                                                            | 2        |
| Font size        | Not on the saved type scale, with 1 pixel tolerance                                   | 2        |
| Spacing          | Padding or gap not on the saved scale, with 2 pixel tolerance                         | 1        |
| Radius           | Not on the saved radius scale, with 1 pixel tolerance                                 | 1        |

The primary button is the first visible button, or the button with `data-primary="true"`. Each finding cites `project-design-memory` as primary and `nielsen-h4` as related. The local `DESIGN.md` path is the citation target. This connects visual drift back to the approved design.

## The states check

The states check tests a route without adding test code to the app. `fr_states` covers five states:

| State     | How it is reached                                                                     | Passes when                                                                     |
| --------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Empty     | Same-origin JSON responses return an empty array                                      | A visible message explains the empty state and offers a next step               |
| Loading   | Same-origin responses are held for 10 seconds and the page is captured at 1.5 seconds | A loading indicator is visible within 1 second                                  |
| Error     | Same-origin responses return status 500                                               | A visible message names the problem and offers recovery                         |
| Long text | API strings are tripled, and visible headings and labels are repeated three times     | Text does not clip or overflow, and there is no horizontal scroll at 320 pixels |
| Dark mode | The browser emulates dark mode and the page gets the `dark` class                     | The dark mode color-contrast audit passes                                       |

Loading indicators are detected through `aria-busy="true"`, `role="progressbar"`, `role="status"`, `.skeleton` or `.spinner`. Error recovery is recognized through retry, go back, contact, support or reload controls. Empty and error messages are detected from visible text and visible actions.

If a page makes no same-origin API calls for empty, loading or error, that state is marked `not_reachable` with a short reason. That is not a failure. Long and dark still run. Screenshots go under `.fitroom/states/<page>/`, and the full result goes to `.fitroom/states/report.json`.

Failures cite `nielsen-h1` for empty and loading, `nielsen-h9` for error, `wcag22-1.4.10` with related `wcag22-1.4.12` for long text, and `wcag22-1.4.3` with related `wcag22-1.4.11` for dark mode.

## Handoff and the verify loop

`fr_handoff` writes `.fitroom/handoffs/<handoffId>/`. The folder contains the selected source, reference screenshots at 375, 768 and 1440 pixels, `tokens.json`, `handoff.json`, `structure.json`, `edits.json`, `findings-fixed.json`, `brief.md` and `checklist.md`. The brief tells the agent to apply the design to the real route, reuse components, keep data and content, use the tokens, match the screenshots and call `fr_verify` with the route and handoff ID. The handoff also saves design memory.

`fr_verify` captures the real route at the three widths with a 900 pixel viewport. It waits for network idle and fonts, disables animations and hides the caret. The comparison has three parts:
1. **Pixels.** Each screenshot is split into a 3 by 3 grid. Each region uses pixelmatch at threshold 0.1 with anti-aliasing excluded. A region passes only under 2 percent difference. A dimension mismatch fails the region at 100 percent.
2. **Computed styles.** At 1440 pixels, Fitroom reads 21 properties for every element with a `data-fr-id`: background color, four border colors, four radii, text color, column gap, font family, font size, font weight, gap, line height, four padding values and row gap. Border colors are skipped. The other values must match the handoff strings exactly.
3. **Content order and structure.** The captured `data-fr-id` order must match the handoff order. When `structure.json` has blocks, visible blocks must appear in saved order and hidden blocks must not appear.

The build passes only when every pixel region passes, every style matches, the content order matches and the structure order matches. `fr_verify` sets the board status to `verified` or `verify_failed` and returns each mismatch with its element ID and property. Screenshots and diff images stay under `.fitroom/verifications/`.

## Rebuild flow

Keep the boundaries small. Put capture, audit, edit, memory, states, handoff and verify in core. Keep MCP, CLI and board thin. Import registry and direction JSON at build time. Store generated files under `.fitroom`. Keep the board on `127.0.0.1` and require the token. Let the agent write variant source and let the board edit that same source through operation logs.

The full loop is:
1. The agent starts the MCP server in the user's project.
2. `fr_scopes` picks one page group and shows the scope summary.
3. `fr_capture` or `fr_audit` captures only that group at 375, 768 and 1440 pixels.
4. Automated findings are measured and cited. The agent reviews the screenshots, submits judged findings and passes the validator.
5. `fr_directions` returns the Refined, Native, Bold and Wildcard briefs.
6. The agent writes the four variants and registers them. New WCAG AA failures are rejected.
7. The board shows the cards. The user pins, edits, restores and approves a direction.
8. `fr_handoff` writes the source, screenshots, tokens, structure, edit log and brief, and saves design memory.
9. The agent applies the design to the real route.
10. `fr_verify` compares pixels, styles, content order and structure. The result is `verified` or `verify_failed`.
11. `fr_states` checks the five UI states, and later audits compare the build with design memory.

The result is a local, file-backed loop. The agent gets code and evidence. The user gets a visual board and an audit trail. The final build is checked against the design the user actually approved.
